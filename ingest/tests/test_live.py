"""A live edition updating over time, using the real Worlds 2024 fixture as if it were live."""

import copy
from datetime import UTC, datetime
from pathlib import Path

import pytest

from lol_ingest.pipeline import RunOptions, run
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.registry import EditionSpec, load_registry
from lol_ingest.report import EditionReport, render_json, render_markdown

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


def places_pending(snapshot: Snapshot) -> Snapshot:
    """The final is played, but Leaguepedia hasn't filled in the top two places yet."""
    tables = copy.deepcopy(snapshot.tables)
    tables["results"] = [
        {**r, "Team": ""} if r["Place"] in ("1", "2") else r for r in tables["results"]
    ]
    return Snapshot(tables)


def run_once(
    data_dir: Path, snapshot: Snapshot, when: int, operation: str = "refresh", **options: object
) -> EditionReport:
    def fetch(spec: EditionSpec, use_cache: bool) -> Snapshot:
        return snapshot

    run_options = RunOptions(operation, "worlds", "2024", data_dir, **options)  # type: ignore[arg-type]
    [report] = run(run_options, fetch, datetime(2026, 10, when, tzinfo=UTC))
    return report


def test_a_live_edition_updates_and_is_safe_to_auto_merge(
    data_dir: Path, snapshot: Snapshot
) -> None:
    set_status(data_dir, "live")
    first = run_once(data_dir, before_final(snapshot), 1)
    assert first.errors == []
    assert render_json([first])["autoMergeSafe"] is True

    second = run_once(data_dir, places_pending(snapshot), 2)

    assert not second.completed
    assert second.merge is not None
    kinds = {(c.key.split(":", 1)[0], c.kind) for c in second.merge.applied}
    assert ("series", "modified") in kinds  # the final's result filled in
    assert ("game", "added") in kinds
    assert second.merge.blocked == []
    assert render_json([second])["autoMergeSafe"] is True


def test_a_finished_edition_is_completed_and_waits_for_review(
    data_dir: Path, snapshot: Snapshot
) -> None:
    set_status(data_dir, "live")
    run_once(data_dir, places_pending(snapshot), 1)

    finished = run_once(data_dir, snapshot, 2)

    assert finished.completed
    assert load_registry(data_dir).select("worlds", "2024")[0].status == "completed"
    assert finished.merge is not None
    assert {r.status for r in finished.merge.provenance.records} == {"verified"}
    assert render_json([finished])["autoMergeSafe"] is False
    assert render_json([finished])["completed"] == ["worlds-2024"]
    assert "Edition finished" in render_markdown([finished])

    # From then on, provider changes to the verified records need review.
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


def test_a_dry_run_never_completes_an_edition(data_dir: Path, snapshot: Snapshot) -> None:
    set_status(data_dir, "live")

    report = run_once(data_dir, snapshot, 1, operation="dry-run")

    assert not report.completed
    assert load_registry(data_dir).select("worlds", "2024")[0].status == "live"
