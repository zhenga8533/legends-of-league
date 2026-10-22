import datetime as dt
from collections.abc import Sequence

from lol_ingest.identity import EntityStore
from lol_ingest.lineage import Rename, apply_lineage, fetch_renames
from lol_ingest.models.common import DateRange, ExternalRef
from lol_ingest.models.entities import Organization, OrgLink, TeamIdentity

Row = dict[str, str]


def team(page: str, org: str) -> TeamIdentity:
    slug = page.lower().replace(" ", "-").replace(".", "")
    return TeamIdentity(
        id=f"team:{slug}",
        org=org,
        name=page,
        region="region:lck",
        active=DateRange(),
        external_refs=[ExternalRef(provider="leaguepedia", key="OverviewPage", value=page)],
    )


def store_of(*teams: TeamIdentity) -> EntityStore:
    store = EntityStore()
    for t in teams:
        store.teams[t.id] = t
        store.organizations.setdefault(t.org, Organization(id=t.org, name=t.name))
    return store


def rename(date: str, original: str, new: str, verb: str) -> Rename:
    return Rename(dt.date.fromisoformat(date), original, new, verb)


SKT_T1 = rename("2019-12-08", "SK Telecom T1", "T1", "rebrand")
SAMSUNG_KSV = rename("2017-11-30", "Samsung Galaxy", "KSV eSports", "acquire")
KSV_GENG = rename("2018-05-03", "KSV eSports", "Gen.G", "rebrand")


def test_a_rebrand_puts_both_identities_under_the_newer_organization() -> None:
    store = store_of(team("SK Telecom T1", "org:sk-telecom-t1"), team("T1", "org:t1"))

    report = apply_lineage(store, [SKT_T1])

    assert {t.org for t in store.teams.values()} == {"org:t1"}
    assert report.removed_orgs == ["org:sk-telecom-t1"]
    assert list(store.organizations) == ["org:t1"]


def test_an_acquisition_links_organizations_through_unarchived_names() -> None:
    store = store_of(team("Samsung Galaxy", "org:samsung-galaxy"), team("Gen.G", "org:gen-g"))

    apply_lineage(store, [SAMSUNG_KSV, KSV_GENG])

    assert store.teams["team:samsung-galaxy"].org == "org:samsung-galaxy"
    assert store.organizations["org:gen-g"].lineage == [
        OrgLink(org="org:samsung-galaxy", relation="acquisition", date=dt.date(2017, 11, 30))
    ]


def test_it_is_idempotent_and_tolerates_leaguepedia_spellings() -> None:
    store = store_of(team("SK Telecom T1", "org:sk-telecom-t1"), team("T1", "org:t1"))
    misspelled = rename("2019-12-08", "SK Telecom T1", "T1", "Reband")
    partner = rename("2020-01-01", "T1", "Someone", "partner")

    first = apply_lineage(store, [misspelled, partner])
    second = apply_lineage(store, [misspelled, partner])

    assert first.changed and not second.changed
    assert first.ignored == [partner]


def test_teams_sharing_an_organization_page_stay_together() -> None:
    store = store_of(team("Samsung White", "org:samsung"), team("Samsung Blue", "org:samsung"))

    report = apply_lineage(store, [])

    assert not report.changed


class FakeCargo:
    def __init__(self, rows: list[Row]) -> None:
        self.rows = rows

    def query(
        self, tables: str, fields: Sequence[str], *, where: str = "", order_by: str = ""
    ) -> list[Row]:
        return [r for r in self.rows if f'"{r[order_by]}"'.casefold() in where.casefold()]


def test_fetching_follows_chains_transitively() -> None:
    rows = [
        {"Date": "2017-11-30", "OriginalName": "Samsung Galaxy", "NewName": "KSV eSports",
         "Verb": "acquire"},
        {"Date": "2018-05-03", "OriginalName": "KSV eSports", "NewName": "Gen.G",
         "Verb": "rebrand"},
        {"Date": "2020-01-01", "OriginalName": "Unrelated", "NewName": "Other", "Verb": "rename"},
    ]  # fmt: skip

    renames = fetch_renames(FakeCargo(rows), ["gen.g"])

    assert [(r.original, r.new) for r in renames] == [
        ("Samsung Galaxy", "KSV eSports"),
        ("KSV eSports", "Gen.G"),
    ]
