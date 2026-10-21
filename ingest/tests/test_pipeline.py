from datetime import UTC, datetime
from pathlib import Path

import pytest

from lol_ingest.identity import EntityStore
from lol_ingest.pipeline import Operation, RunOptions, UsageError, run
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.registry import EditionSpec
from lol_ingest.report import EditionReport

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
EDITION = Path("tournaments") / "worlds" / "2024"


def run_op(
    data_dir: Path, snapshot: Snapshot, operation: Operation, **kwargs: object
) -> EditionReport:
    def fetch(spec: EditionSpec, use_cache: bool) -> Snapshot:
        return snapshot

    options = RunOptions(operation, "worlds", "2024", data_dir, **kwargs)  # type: ignore[arg-type]
    [report] = run(options, fetch, NOW)
    return report


def tree(directory: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def test_import_writes_edition_entities_and_log(data_dir: Path, snapshot: Snapshot) -> None:
    report = run_op(data_dir, snapshot, "import")

    assert report.errors == [] and report.files_changed
    edition = data_dir / EDITION
    assert {p.name for p in edition.iterdir()} == {
        "edition.json",
        "series.json",
        "games.json",
        "player-stats.json",
        "rosters.json",
        "results.json",
        "provenance.json",
    }
    assert "team:t1" in EntityStore.load(data_dir).teams
    assert len(list((data_dir / "_meta" / "import-runs").iterdir())) == 1


def test_reimport_is_idempotent(data_dir: Path, snapshot: Snapshot) -> None:
    run_op(data_dir, snapshot, "import")
    before = tree(data_dir)

    report = run_op(data_dir, snapshot, "import")

    assert not report.files_changed
    assert tree(data_dir) == before


def test_validate_passes_on_imported_data(data_dir: Path, snapshot: Snapshot) -> None:
    run_op(data_dir, snapshot, "import")

    assert run_op(data_dir, snapshot, "validate").errors == []


def test_dry_run_writes_nothing(data_dir: Path, snapshot: Snapshot) -> None:
    before = tree(data_dir)

    report = run_op(data_dir, snapshot, "dry-run")

    assert report.merge and report.merge.applied
    assert report.new_entities
    assert tree(data_dir) == before


def test_provider_change_to_verified_record_is_blocked(data_dir: Path, snapshot: Snapshot) -> None:
    run_op(data_dir, snapshot, "import")
    series_file = data_dir / EDITION / "series.json"
    before = series_file.read_bytes()
    snapshot.tables["matches"][0]["Patch"] = "99.1"

    report = run_op(data_dir, snapshot, "import")

    assert report.merge and [c.kind for c in report.merge.blocked] == ["modified"]
    assert series_file.read_bytes() == before


def test_failed_import_writes_nothing(data_dir: Path, snapshot: Snapshot) -> None:
    for row in snapshot.tables["rosters"]:
        row["Region"] = "ZZ"
    before = tree(data_dir)

    report = run_op(data_dir, snapshot, "import")

    assert report.errors
    assert tree(data_dir) == before


def test_unknown_edition_is_a_usage_error(data_dir: Path, snapshot: Snapshot) -> None:
    with pytest.raises(UsageError):
        run(RunOptions("import", "msi", "1999", data_dir), lambda spec, cache: snapshot, NOW)


def test_validate_only_warns_about_editions_not_imported_yet(
    data_dir: Path, snapshot: Snapshot
) -> None:
    report = run_op(data_dir, snapshot, "validate")

    assert report.errors == []
    assert [w.code for w in report.warnings] == ["not-imported"]
