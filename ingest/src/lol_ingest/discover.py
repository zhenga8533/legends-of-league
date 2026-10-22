"""Drafts registry entries and rulesets for upcoming editions found on Leaguepedia.

A draft copies the tournament's previous edition: its stages, how each page's schedule tabs map
onto them, and its ruleset. Formats change most years, so a draft is a starting point for
review, never something imported unreviewed.
"""

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from lol_ingest.identity import EntityStore
from lol_ingest.providers.leaguepedia.fetch import Client, chunked_query, quote
from lol_ingest.registry import EditionSpec, LeaguepediaPage, Registry

PROVIDER = "leaguepedia"
# Drafts appear this long before an event starts, once Leaguepedia has dated it.
DRAFT_WINDOW_DAYS = 60
DRAFT_NOTE = (
    "DRAFT: copied from {previous} by lol-ingest discover. "
    "Verify the format, then remove this note."
)


@dataclass
class DraftPage:
    page: str
    tabs: list[str]
    # The previous edition's page with the same suffix (e.g. "/Main Event"), if any.
    copied_from: str | None
    mapping: LeaguepediaPage


@dataclass
class Draft:
    tournament: str
    year: int
    name: str
    base_page: str
    start: dt.date
    end: dt.date | None
    previous: EditionSpec
    pages: list[DraftPage]
    missing: list[str] = field(default_factory=list)  # previous pages with no counterpart yet

    @property
    def slug(self) -> str:
        return f"{self.tournament}-{self.year}"


@dataclass
class Skipped:
    tournament: str
    year: int
    reason: str


def _date(value: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def _suffix(page: str, base: str) -> str | None:
    if page == base:
        return ""
    return page[len(base) :] if page.startswith(base + "/") else None


def discover(
    client: Client,
    registry: Registry,
    store: EntityStore,
    today: dt.date,
    window_days: int = DRAFT_WINDOW_DAYS,
) -> tuple[list[Draft], list[Skipped]]:
    """Unregistered editions of registered tournaments that start within the window."""
    leagues = {
        ref.value: tournament_id.split(":", 1)[1]
        for tournament_id, tournament in store.tournaments.items()
        for ref in tournament.external_refs
        if (ref.provider, ref.key) == (PROVIDER, "League")
    }
    registered = {spec.slug for spec in registry.editions}
    drafts: list[Draft] = []
    skipped: list[Skipped] = []
    for league, tournament in sorted(leagues.items(), key=lambda item: item[1]):
        editions = [spec for spec in registry.editions if spec.tournament == tournament]
        if not editions:
            continue
        previous = max(editions, key=lambda spec: spec.year)
        # Leaguepedia names each edition's pages the same way ("2026 Season World Championship"),
        # which also tells them apart from qualifiers filed under the same league.
        if str(previous.year) not in previous.leaguepedia.base_page:
            continue
        pattern = previous.leaguepedia.base_page.replace(str(previous.year), "{year}")
        rows = client.query(
            "Tournaments",
            ["OverviewPage", "BasePage", "DateStart", "Date", "Year"],
            where=f"League = {quote(league)} AND Year > {previous.year}",
            order_by="DateStart",
        )
        for year in sorted({int(row["Year"]) for row in rows if row["Year"].isdigit()}):
            base = pattern.format(year=year)
            pages = [
                row
                for row in rows
                if row["Year"] == str(year)
                and (_suffix(row["OverviewPage"], base) is not None or row["BasePage"] == base)
            ]
            if f"{tournament}-{year}" in registered or not pages:
                continue
            starts = [d for row in pages if (d := _date(row["DateStart"]))]
            ends = [d for row in pages if (d := _date(row["Date"]))]
            if not starts:
                skipped.append(Skipped(tournament, year, "Leaguepedia has no dates yet"))
                continue
            start = min(starts)
            if start > today + dt.timedelta(days=window_days):
                skipped.append(
                    Skipped(tournament, year, f"starts {start}, more than {window_days} days away")
                )
                continue
            drafts.append(
                _draft(
                    client, tournament, year, base, start, max(ends, default=None), previous, pages
                )
            )
    return drafts, skipped


def _draft(
    client: Client,
    tournament: str,
    year: int,
    base: str,
    start: dt.date,
    end: dt.date | None,
    previous: EditionSpec,
    rows: list[dict[str, str]],
) -> Draft:
    page_names = [row["OverviewPage"] for row in rows]
    tabs: dict[str, list[str]] = {page: [] for page in page_names}
    for row in chunked_query(
        client, "MatchSchedule", ["OverviewPage", "Tab"], "OverviewPage", page_names
    ):
        if row["Tab"] and row["Tab"] not in tabs[row["OverviewPage"]]:
            tabs[row["OverviewPage"]].append(row["Tab"])

    previous_base = previous.leaguepedia.base_page
    by_suffix = {
        suffix: page
        for page in previous.leaguepedia.pages
        if (suffix := _suffix(page.page, previous_base)) is not None
    }
    first_stage = previous.stages[0].id
    pages: list[DraftPage] = []
    for name in page_names:
        counterpart = by_suffix.get(_suffix(name, base) or "")
        if counterpart is None and not tabs[name]:
            continue  # a page without matches or a counterpart (e.g. an overview page)
        mapping = (
            counterpart.model_copy(update={"page": name})
            if counterpart
            else LeaguepediaPage(page=name, stage=first_stage)
        )
        pages.append(
            DraftPage(name, tabs[name], counterpart.page if counterpart else None, mapping)
        )
    covered = {page.copied_from for page in pages}
    return Draft(
        tournament=tournament,
        year=year,
        name=previous.name.replace(str(previous.year), str(year)),
        base_page=base,
        start=start,
        end=end,
        previous=previous,
        pages=pages,
        missing=[p.page for p in previous.leaguepedia.pages if p.page not in covered],
    )


def _yaml_string(value: str) -> str:
    """A plain YAML scalar when safe, otherwise double-quoted (JSON strings are valid YAML)."""
    plain = re.fullmatch(r"[A-Za-z0-9][\w .()'/&+-]*", value) and not value.endswith(" ")
    return value if plain else json.dumps(value, ensure_ascii=False)


def render_entry(draft: Draft) -> str:
    """The registry entry, in editions.yaml's own style."""
    lines = [
        "  # Draft by lol-ingest discover, copied from the previous edition: check the pages, how",
        "  # their tabs map onto stages, the stages, and the ruleset before merging.",
        f"  - tournament: {draft.tournament}",
        f"    year: {draft.year}",
        f"    name: {_yaml_string(draft.name)}",
        "    status: upcoming",
        "    stages:",
        *(
            f"      - {{ id: {stage.id}, name: {_yaml_string(stage.name)} }}"
            for stage in draft.previous.stages
        ),
        "    leaguepedia:",
        f"      basePage: {_yaml_string(draft.base_page)}",
        "      pages:",
    ]
    for page in draft.pages:
        lines.append(f"        - page: {_yaml_string(page.page)}")
        if page.mapping.stage is not None:
            lines.append(f"          stage: {page.mapping.stage}")
        else:
            lines.append("          tabs:")
            lines += [
                f"            {json.dumps(glob)}: {stage}"
                for glob, stage in page.mapping.tabs.items()
            ]
    return "\n".join(lines) + "\n"


def render_ruleset(draft: Draft, previous_text: str) -> str:
    """The previous edition's ruleset with its identity swapped, edited as text so the file
    keeps the formatting it was committed with."""
    old, new = draft.previous, draft
    text = previous_text
    replacements = [
        (f'"id": "{old.slug}"', f'"id": "{new.slug}"'),
        (f'"ed:{old.slug}"', f'"ed:{new.slug}"'),
        (
            f'"name": "{_ruleset_name(previous_text)}"',
            f'"name": "{_ruleset_name(previous_text).replace(str(old.year), str(new.year))}"',
        ),
    ]
    for before, after in replacements:
        if before not in text:
            raise ValueError(f"{old.slug}'s ruleset has no {before}")
        text = text.replace(before, after, 1)
    text = re.sub(
        r'("sources": \[)[^\]]*\]',
        lambda m: m.group(1) + json.dumps(_wiki_url(new.base_page)) + "]",
        text,
        count=1,
    )
    note = json.dumps(DRAFT_NOTE.format(previous=old.slug))
    return re.sub(
        r'("notes": \[\n)(\s*)',
        lambda m: f"{m.group(1)}{m.group(2)}{note},\n{m.group(2)}",
        text,
        count=1,
    )


def _ruleset_name(text: str) -> str:
    return str(json.loads(text)["name"])


def _wiki_url(page: str) -> str:
    return "https://lol.fandom.com/wiki/" + page.replace(" ", "_")


def write_draft(draft: Draft, data_dir: Path, rulesets_dir: Path) -> None:
    registry = data_dir / "editions.yaml"
    text = registry.read_text(encoding="utf-8").rstrip("\n")
    registry.write_text(text + "\n\n" + render_entry(draft), encoding="utf-8", newline="\n")
    previous = (rulesets_dir / f"{draft.previous.slug}.json").read_text(encoding="utf-8")
    (rulesets_dir / f"{draft.slug}.json").write_text(
        render_ruleset(draft, previous), encoding="utf-8", newline="\n"
    )


def render_markdown(drafts: list[Draft], skipped: list[Skipped]) -> str:
    out = ["## New editions", ""]
    if not drafts:
        out.append("No new editions to draft.")
    for draft in drafts:
        dates = f"{draft.start}" + (f" to {draft.end}" if draft.end else "")
        out += [
            f"### {draft.name} (`{draft.slug}`, {dates})",
            "",
            f"Copied from `{draft.previous.slug}`. Review before merging:",
            "",
            "- [ ] The format: stages in `data/editions.yaml` and `rulesets/"
            f"{draft.slug}.json` (remove the DRAFT note once checked).",
            "- [ ] Each page's tab mapping, against the tabs Leaguepedia has so far:",
        ]
        for page in draft.pages:
            source = (
                f"copied from `{page.copied_from}`"
                if page.copied_from
                else "**no counterpart: guessed**"
            )
            tabs = ", ".join(f"`{tab}`" for tab in page.tabs) or "no schedule yet"
            out.append(f"  - `{page.page}` ({source}): {tabs}")
        if draft.missing:
            out.append(
                "- [ ] Pages the previous edition had, not on Leaguepedia yet: "
                + ", ".join(f"`{page}`" for page in draft.missing)
            )
        out += [
            "- [ ] New region spellings in `data/entities/regions.json` (a dry run reports them).",
            "",
            "Once merged, the live sync imports it as `upcoming` and switches it to `live` "
            "when the first result is in.",
            "",
        ]
    if skipped:
        out += ["Found but not drafted yet:", ""]
        out += [f"- `{s.tournament}-{s.year}`: {s.reason}" for s in skipped]
    return "\n".join(out) + "\n"
