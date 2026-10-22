"""Orchestrates fetch -> normalize -> validate -> merge -> write for each selected edition."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

from lol_ingest.edition_data import EditionData, Issue, load_edition, save_edition
from lol_ingest.identity import EntityStore
from lol_ingest.jsonio import write_text_atomic
from lol_ingest.merge import merge
from lol_ingest.paths import edition_dir
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.providers.leaguepedia.normalize import PROVIDER, normalize
from lol_ingest.registry import EditionSpec, load_registry, set_status
from lol_ingest.report import EditionReport, render_json
from lol_ingest.validate import validate_edition

Operation = Literal["import", "refresh", "validate", "dry-run"]
# (edition, use_cache) -> raw snapshot
Fetch = Callable[[EditionSpec, bool], Snapshot]


class UsageError(ValueError):
    pass


@dataclass(frozen=True)
class RunOptions:
    operation: Operation
    tournament: str
    year: str
    data_dir: Path
    force: bool = False
    status: str = "all"


def _snapshot_files(directory: Path) -> dict[str, bytes]:
    if not directory.exists():
        return {}
    return {path.name: path.read_bytes() for path in directory.iterdir() if path.is_file()}


def run(options: RunOptions, fetch: Fetch, now: datetime) -> list[EditionReport]:
    specs = load_registry(options.data_dir).select(options.tournament, options.year, options.status)
    if not specs and options.status in ("live", "active"):
        return []  # The scheduled live sync runs even when no event is live.
    if not specs:
        raise UsageError(
            f"no editions in data/editions.yaml match tournament={options.tournament} "
            f"year={options.year}"
        )
    store = EntityStore.load(options.data_dir)
    # Each edition is fetched once, even when it is re-imported after finishing.
    snapshots: dict[tuple[str, bool], Snapshot] = {}

    def fetch_once(spec: EditionSpec, use_cache: bool) -> Snapshot:
        key = (spec.slug, use_cache)
        if key not in snapshots:
            snapshots[key] = fetch(spec, use_cache)
        return snapshots[key]

    reports = []
    for spec in specs:
        report = _run_edition(spec, options, fetch_once, store, now)
        if spec.status == "upcoming" and _started(report):
            set_status(options.data_dir, spec.tournament, spec.year, "live")
            spec = spec.model_copy(update={"status": "live"})
            report = _run_edition(spec, options, fetch_once, store, now)
            report.started = True
        if spec.status == "live" and _finished(report):
            set_status(options.data_dir, spec.tournament, spec.year, "completed")
            finished = spec.model_copy(update={"status": "completed"})
            started = report.started
            report = _run_edition(finished, options, fetch_once, store, now)
            report.started, report.completed = started, True
        reports.append(report)

    if options.operation in ("import", "refresh") and store.added:
        store.save(options.data_dir)
    return reports


def _written(report: EditionReport) -> EditionData | None:
    if report.errors or report.merge is None or report.operation not in ("import", "refresh"):
        return None
    return EditionData.from_records(report.merge.records)


def _started(report: EditionReport) -> bool:
    """Whether an upcoming edition just written has its first result."""
    data = _written(report)
    return data is not None and any(series.score is not None for series in data.series)


def _finished(report: EditionReport) -> bool:
    """Whether a live edition just written is over: every participant has a place and every
    series a result. Leaguepedia fills places in over a few hours after a final, so waiting for
    all of them (not just the champion) avoids verifying a half-updated results table."""
    data = _written(report)
    if data is None:
        return False
    placed = {placement.team for placement in data.placements}
    return (
        bool(data.series)
        and all(participant.team in placed for participant in data.edition.participants)
        and all(series.score is not None for series in data.series)
        and not any(gap.reason == "teams not decided yet" for gap in report.gaps)
    )


def _run_edition(
    spec: EditionSpec, options: RunOptions, fetch: Fetch, store: EntityStore, now: datetime
) -> EditionReport:
    report = EditionReport(edition=spec.slug, operation=options.operation)
    directory = edition_dir(options.data_dir, spec.tournament, spec.year)
    existing = load_edition(directory)

    if options.operation == "validate":
        if existing is None:
            report.issues.append(
                Issue("warning", "not-imported", f"{spec.slug} has not been imported yet")
            )
        else:
            report.issues = validate_edition(existing[0], store)
            report.gaps = existing[1].gaps
        return report

    # Entities proposed while normalizing a failing edition must not be saved.
    checkpoint = store.checkpoint()
    added_before = set(store.added)

    snapshot = fetch(spec, options.operation != "refresh")
    report.provider = PROVIDER
    report.snapshot_sha256 = snapshot.sha256()
    normalized = normalize(snapshot, spec, store)
    report.gaps = normalized.gaps
    report.issues = normalized.issues + validate_edition(normalized.data, store)
    if report.errors:
        store.restore(checkpoint)
        return report

    run_id = f"{spec.slug}-{now:%Y%m%dT%H%M%SZ}"
    result = merge(
        existing,
        normalized.data,
        refs=normalized.refs,
        gaps=normalized.gaps,
        provider=PROVIDER,
        run_id=run_id,
        force=options.force,
    )
    report.merge = result
    merged = EditionData.from_records(result.records)
    if result.blocked:
        # Keeping old versions of some records can leave the mix inconsistent.
        report.issues += validate_edition(merged, store)
        if report.errors:
            store.restore(checkpoint)
            return report
    report.new_entities = sorted(store.added - added_before)

    if options.operation == "dry-run":
        store.restore(checkpoint)
        return report

    before = _snapshot_files(directory)
    save_edition(directory, merged, result.provenance)
    report.files_changed = _snapshot_files(directory) != before or bool(report.new_entities)
    if report.files_changed:
        log = {
            "run": run_id,
            "at": now.isoformat(),
            "operation": options.operation,
            "force": options.force,
            "summary": render_json([report])["editions"][0],
        }
        write_text_atomic(
            options.data_dir / "_meta" / "import-runs" / f"{run_id}.json",
            json.dumps(log, indent=2, ensure_ascii=False) + "\n",
        )
    return report
