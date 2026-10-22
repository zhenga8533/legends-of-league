"""Organization lineage from Leaguepedia's TeamRenames table.

Team identities joined by renames or rebrands belong to one organization (SK Telecom T1 -> T1).
An acquisition (Samsung Galaxy's spot -> KSV, later rebranded Gen.G) keeps the organizations
apart and links them instead. Chains are followed through names that never played an
international event (KSV), but only organizations behind archived teams are kept.
"""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass, field

from lol_ingest.identity import EntityStore
from lol_ingest.models.entities import Organization, OrgLink
from lol_ingest.providers.leaguepedia.fetch import Client, chunked_query

PROVIDER = "leaguepedia"
FIELDS = ["Date", "OriginalName", "NewName", "Verb"]
# Followed renames per name; real chains are a handful of steps long.
MAX_DEPTH = 8

# Leaguepedia's verbs, including the misspellings and casing found in the table.
SAME_ORG = {"rename", "rebrand", "reband"}
ACQUISITION = {"acquire", "acuire"}


@dataclass(frozen=True)
class Rename:
    date: dt.date | None
    original: str
    new: str
    verb: str


@dataclass
class LineageReport:
    renames: int = 0
    regrouped: list[tuple[str, str, str]] = field(default_factory=list)  # team, old org, new org
    removed_orgs: list[str] = field(default_factory=list)
    links: dict[str, list[OrgLink]] = field(default_factory=dict)
    ignored: list[Rename] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.regrouped or self.removed_orgs or self.links)


def _date(value: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def fetch_renames(client: Client, pages: Iterable[str]) -> list[Rename]:
    """Every rename touching the pages, and the renames touching those, transitively."""
    seen: set[str] = set()
    frontier = {page.casefold(): page for page in pages}
    found: dict[tuple[str, str, str], Rename] = {}
    for _ in range(MAX_DEPTH):
        names = [name for key, name in frontier.items() if key not in seen]
        if not names:
            break
        seen.update(name.casefold() for name in names)
        rows = chunked_query(client, "TeamRenames", FIELDS, "OriginalName", names)
        rows += chunked_query(client, "TeamRenames", FIELDS, "NewName", names)
        frontier = {}
        for row in rows:
            rename = Rename(_date(row["Date"]), row["OriginalName"], row["NewName"], row["Verb"])
            found[(row["Date"], rename.original.casefold(), rename.new.casefold())] = rename
            for name in (rename.original, rename.new):
                frontier.setdefault(name.casefold(), name)
    return sorted(found.values(), key=lambda r: (r.date or dt.date.min, r.original, r.new))


class _Groups:
    """Union-find over case-folded page names."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, name: str) -> str:
        self.parent.setdefault(name, name)
        while self.parent[name] != name:
            self.parent[name] = self.parent[self.parent[name]]
            name = self.parent[name]
        return name

    def union(self, a: str, b: str) -> None:
        self.parent[self.find(a)] = self.find(b)


def apply_lineage(store: EntityStore, renames: Iterable[Rename]) -> LineageReport:
    renames = list(renames)
    report = LineageReport(renames=len(renames))
    page_of = {
        team_id: ref.value.casefold()
        for team_id, team in store.teams.items()
        for ref in team.external_refs
        if (ref.provider, ref.key) == (PROVIDER, "OverviewPage")
    }
    groups = _Groups()
    # Teams already sharing an organization (Leaguepedia's OrganizationPage) stay together.
    first_page_of_org: dict[str, str] = {}
    for team_id, page in page_of.items():
        team_org = store.teams[team_id].org
        if team_org in first_page_of_org:
            groups.union(page, first_page_of_org[team_org])
        else:
            first_page_of_org[team_org] = page

    acquisitions: list[Rename] = []
    renamed_to_on: dict[str, dt.date] = {}
    for rename in renames:
        verb = rename.verb.casefold()
        original, new = rename.original.casefold(), rename.new.casefold()
        if verb in SAME_ORG:
            groups.union(original, new)
            if rename.date:
                renamed_to_on[new] = max(rename.date, renamed_to_on.get(new, rename.date))
        elif verb in ACQUISITION:
            acquisitions.append(rename)
        else:
            report.ignored.append(rename)

    # Each group keeps the organization of its most recently named archived team.
    members: dict[str, list[str]] = {}
    for team_id, page in sorted(page_of.items()):
        members.setdefault(groups.find(page), []).append(team_id)
    org_of_group: dict[str, str] = {}
    for root, team_ids in members.items():
        latest = max(
            team_ids,
            key=lambda t: (renamed_to_on.get(page_of[t], dt.date.min), store.teams[t].org),
        )
        org_of_group[root] = store.teams[latest].org
        for team_id in team_ids:
            team = store.teams[team_id]
            if team.org != org_of_group[root]:
                report.regrouped.append((team_id, team.org, org_of_group[root]))
                store.teams[team_id] = team.model_copy(update={"org": org_of_group[root]})

    used = {team.org for team in store.teams.values()}
    for org_id in sorted(set(store.organizations) - used):
        report.removed_orgs.append(org_id)
        del store.organizations[org_id]

    links: dict[str, list[OrgLink]] = {}
    for rename in acquisitions:
        acquired = org_of_group.get(groups.find(rename.original.casefold()))
        acquirer = org_of_group.get(groups.find(rename.new.casefold()))
        if acquired and acquirer and acquired != acquirer:
            link = OrgLink(org=acquired, relation="acquisition", date=rename.date)
            if link not in links.setdefault(acquirer, []):
                links[acquirer].append(link)
    for org_id, org in store.organizations.items():
        wanted = sorted(
            links.get(org_id, []), key=lambda link: (link.date or dt.date.min, link.org)
        )
        # Only acquisition links are derived here; anything else on record is kept.
        kept = [link for link in org.lineage if link.relation != "acquisition"]
        if kept + wanted != org.lineage:
            report.links[org_id] = wanted
            store.organizations[org_id] = Organization.model_validate(
                {**org.model_dump(), "lineage": kept + wanted}
            )
    return report


def render_markdown(report: LineageReport) -> str:
    lines = [
        "## Organization lineage",
        "",
        f"{report.renames} Leaguepedia renames considered.",
        "",
    ]
    if not report.changed:
        lines.append("No changes.")
    for team, old, new in report.regrouped:
        lines.append(f"- `{team}`: `{old}` -> `{new}`")
    for org in report.removed_orgs:
        lines.append(f"- removed `{org}` (no team identities left)")
    for org, links in report.links.items():
        described = ", ".join(
            f"acquired `{link.org}`'s spot ({link.date or 'date unknown'})" for link in links
        )
        lines.append(f"- `{org}`: {described or 'no acquisitions'}")
    if report.ignored:
        lines += ["", "Ignored renames (unknown verb):"]
        lines += [f"- {r.date}: {r.original} -> {r.new} ({r.verb!r})" for r in report.ignored]
    return "\n".join(lines) + "\n"
