import datetime as dt
import json
import shutil
from collections.abc import Sequence
from pathlib import Path

from lol_ingest.discover import discover, render_markdown, write_draft
from lol_ingest.identity import EntityStore
from lol_ingest.paths import RULESETS_DIR
from lol_ingest.registry import load_registry

Row = dict[str, str]
TODAY = dt.date(2027, 9, 1)
BASE = "2027 Season World Championship"


def tournament(page: str, league: str, start: str = "", base: str = "") -> Row:
    return {"OverviewPage": page, "BasePage": base, "DateStart": start, "Date": "", "Year": "2027",
            "League": league}  # fmt: skip


class FakeLeaguepedia:
    def __init__(self, tournaments: list[Row], tabs: dict[str, list[str]]) -> None:
        self.tournaments = tournaments
        self.tabs = tabs

    def query(
        self, tables: str, fields: Sequence[str], *, where: str = "", order_by: str = ""
    ) -> list[Row]:
        if tables == "Tournaments":
            return [r for r in self.tournaments if f'"{r["League"]}"' in where]
        return [
            {"OverviewPage": page, "Tab": tab}
            for page, tabs in self.tabs.items()
            if f'"{page}"' in where
            for tab in tabs
        ]


WIKI = FakeLeaguepedia(
    [
        tournament(f"{BASE}/Play-In", "World Championship", "2027-09-20", BASE),
        tournament(f"{BASE}/Main Event", "World Championship", "2027-09-28", BASE),
        tournament(f"{BASE}/Showmatch", "World Championship", "2027-10-01", BASE),
        # A qualifier filed under the same league.
        tournament("LPL/2027 Season/Regional Finals", "World Championship", "2027-09-01"),
        tournament("2027 Mid-Season Invitational", "Mid-Season Invitational"),
        tournament("2027 First Stand", "First Stand", "2028-03-01"),
    ],
    {
        f"{BASE}/Play-In": ["Round 1", "Round 2", "Round 3"],
        f"{BASE}/Main Event": ["Round 1"],
        f"{BASE}/Showmatch": ["Day 1"],
    },
)


def test_it_drafts_upcoming_editions_from_the_previous_one(data_dir: Path) -> None:
    drafts, skipped = discover(WIKI, load_registry(data_dir), EntityStore.load(data_dir), TODAY)

    [draft] = drafts
    assert (draft.slug, draft.start, draft.previous.slug) == (
        "worlds-2027",
        dt.date(2027, 9, 20),
        "worlds-2026",
    )
    pages = {page.page: page for page in draft.pages}
    assert pages[f"{BASE}/Play-In"].mapping.tabs == {"Round 3": "play-in-final", "*": "play-in"}
    assert pages[f"{BASE}/Showmatch"].copied_from is None  # no counterpart: guessed
    assert {(s.tournament, s.reason.split(",")[0]) for s in skipped} == {
        ("msi", "Leaguepedia has no dates yet"),
        ("first-stand", "starts 2028-03-01"),
    }
    assert "no counterpart" in render_markdown(drafts, skipped)


def test_a_written_draft_is_a_valid_upcoming_edition(data_dir: Path, tmp_path: Path) -> None:
    rulesets = tmp_path / "rulesets"
    shutil.copytree(RULESETS_DIR, rulesets)
    [draft], _ = discover(WIKI, load_registry(data_dir), EntityStore.load(data_dir), TODAY)

    write_draft(draft, data_dir, rulesets)

    [spec] = load_registry(data_dir).select("worlds", "2027")
    assert spec.status == "upcoming"
    assert [stage.id for stage in spec.stages] == [s.id for s in draft.previous.stages]
    ruleset = json.loads((rulesets / "worlds-2027.json").read_text(encoding="utf-8"))
    previous = json.loads((rulesets / "worlds-2026.json").read_text(encoding="utf-8"))
    assert (ruleset["id"], ruleset["editions"]) == ("worlds-2027", ["ed:worlds-2027"])
    assert ruleset["notes"][0].startswith("DRAFT: copied from worlds-2026")
    assert ruleset["stages"] == previous["stages"]


def test_nothing_is_drafted_for_registered_editions(data_dir: Path) -> None:
    registry = load_registry(data_dir)
    wiki = FakeLeaguepedia(
        [tournament("2026 Season World Championship/Main Event", "World Championship",
                    "2026-10-23", "2026 Season World Championship") | {"Year": "2026"}],
        {},
    )  # fmt: skip

    drafts, _ = discover(wiki, registry, EntityStore.load(data_dir), dt.date(2026, 10, 1))

    assert drafts == []
