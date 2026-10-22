"""A live edition updating over time, using the real Worlds 2024 fixture as if it were live."""

import copy
from datetime import UTC, datetime
from pathlib import Path

import pytest

from lol_ingest.pipeline import RunOptions, run
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.registry import EditionSpec
from lol_ingest.report import EditionReport, render_json

FINAL = "2024 Season World Championship/Main Event_Finals_1"


def set_status(data_dir: Path, status: str) -> None:
    """Sets Worlds 2024's status (the first edition in the registry)."""
    registry = data_dir / "editions.yaml"
    head, sep, tail = registry.read_text(encoding="utf-8").partition("  - tournament: msi")
    lines = [
        f"    status: {status}" if line.startswith("    status: ") else line
        for line in head.splitlines()
    ]
    registry.write_text("\n".join(lines) + "\n" + sep + tail, encoding="utf-8")


def before_final(snapshot: Snapshot) -> Snapshot:
    """The same edition the day before the final: scheduled, but no result yet."""
    tables = copy.deepcopy(snapshot.tables)
    for row in tables["matches"]:
        if row["MatchId"] == FINAL:
            row.update(Team1Score="", Team2Score="", Winner="", MVP="")
    for table in ("games", "drafts", "playerStats"):
        tables[table] = [r for r in tables[table] if not r["GameId"].startswith(FINAL)]
    tables["results"] = [
        {**r, "Team": ""} if r["Place"] in ("1", "2") else r for r in tables["results"]
    ]
    return Snapshot(tables)


def run_once(data_dir: Path, snapshot: Snapshot, when: int, **options: object) -> EditionReport:
    def fetch(spec: EditionSpec, use_cache: bool) -> Snapshot:
        return snapshot

    run_options = RunOptions("refresh", "worlds", "2024", data_dir, **options)  # type: ignore[arg-type]
    [report] = run(run_options, fetch, datetime(2026, 10, when, tzinfo=UTC))
    return report


def test_a_live_edition_updates_and_is_safe_to_auto_merge(
    data_dir: Path, snapshot: Snapshot
) -> None:
    set_status(data_dir, "live")
    first = run_once(data_dir, before_final(snapshot), 1)
    assert first.errors == []
    assert render_json([first])["autoMergeSafe"] is True

    second = run_once(data_dir, snapshot, 2)

    assert second.merge is not None
    kinds = {(c.key.split(":", 1)[0], c.kind) for c in second.merge.applied}
    assert ("series", "modified") in kinds  # the final's result filled in
    assert ("game", "added") in kinds
    assert second.merge.blocked == []
    assert render_json([second])["autoMergeSafe"] is True


def test_finishing_an_edition_verifies_it_and_later_changes_need_review(
    data_dir: Path, snapshot: Snapshot
) -> None:
    set_status(data_dir, "live")
    run_once(data_dir, snapshot, 1)
    set_status(data_dir, "completed")  # flipped by hand once the event is over
    promoted = run_once(data_dir, snapshot, 2)
    assert promoted.merge is not None
    # Only the edition record itself changes (its status); everything else is promoted to verified.
    assert [(c.key, c.kind, c.applied) for c in promoted.merge.changes] == [
        ("edition:ed:worlds-2024", "modified", True)
    ]
    assert {r.status for r in promoted.merge.provenance.records} == {"verified"}

    changed = copy.deepcopy(snapshot.tables)
    changed["matches"][0]["Patch"] = "99.1"
    report = run_once(data_dir, Snapshot(changed), 3)

    assert report.merge is not None and len(report.merge.blocked) == 1
    assert render_json([report])["autoMergeSafe"] is False


def test_undecided_teams_and_places_are_skipped(data_dir: Path, snapshot: Snapshot) -> None:
    set_status(data_dir, "live")
    tables = copy.deepcopy(snapshot.tables)
    tables["matches"].append(
        {
            **tables["matches"][0],
            "MatchId": "future",
            "NMatchInTab": "9",
            "Team1": "TBD",
            "Team2": "TBD",
            "Team1Score": "",
            "Team2Score": "",
            "Winner": "",
        }
    )
    tables["results"].append({**tables["results"][0], "Team": "", "Place": "3-4"})

    report = run_once(data_dir, Snapshot(tables), 1)

    assert report.errors == []
    assert ("series:future", "teams not decided yet") in {(g.record, g.reason) for g in report.gaps}


def test_the_live_sync_is_a_no_op_without_live_editions(data_dir: Path, snapshot: Snapshot) -> None:
    registry = data_dir / "editions.yaml"
    registry.write_text(
        registry.read_text(encoding="utf-8").replace("status: live", "status: completed"),
        encoding="utf-8",
    )
    options = RunOptions("refresh", "all", "all", data_dir, status="live")

    assert (
        run(options, lambda spec, cache: pytest.fail("fetched"), datetime(2026, 1, 1, tzinfo=UTC))
        == []
    )
