from datetime import UTC, datetime

import pytest

from lol_ingest.edition_data import EditionData
from lol_ingest.identity import EntityStore
from lol_ingest.merge import MergeResult, merge
from lol_ingest.models import Provenance
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.providers.leaguepedia.normalize import normalize
from lol_ingest.registry import EditionSpec

T0 = datetime(2026, 1, 1, tzinfo=UTC)
T1 = datetime(2026, 2, 1, tzinfo=UTC)


@pytest.fixture
def data(snapshot: Snapshot, spec: EditionSpec, store: EntityStore) -> EditionData:
    return normalize(snapshot, spec, store).data


def run(
    existing: tuple[EditionData, Provenance] | None,
    incoming: EditionData,
    *,
    now: datetime = T0,
    force: bool = False,
) -> MergeResult:
    return merge(
        existing,
        incoming,
        refs={},
        gaps=[],
        provider="leaguepedia",
        run_id=f"run-{now:%m}",
        force=force,
    )


def first_import(data: EditionData) -> tuple[EditionData, Provenance]:
    result = run(None, data)
    return EditionData.from_records(result.records), result.provenance


def with_patch(data: EditionData, patch: str) -> EditionData:
    changed = EditionData.from_records(data.records())
    changed.series[0] = changed.series[0].model_copy(update={"patch": patch})
    return changed


def test_first_import_adds_everything_as_verified(data: EditionData) -> None:
    result = run(None, data)

    assert len(result.applied) == len(data.records())
    assert {record.status for record in result.provenance.records} == {"verified"}


def test_reimport_changes_nothing_including_provenance(data: EditionData) -> None:
    existing = first_import(data)

    result = run(existing, data, now=T1)

    assert result.changes == []
    assert result.provenance == existing[1]


def test_changes_to_verified_records_are_blocked(data: EditionData) -> None:
    existing = first_import(data)

    result = run(existing, with_patch(data, "99.1"), now=T1)

    assert [(c.kind, c.applied) for c in result.changes] == [("modified", False)]
    assert result.records[f"series:{data.series[0].id}"] == existing[0].series[0]


def test_force_applies_changes_to_verified_records(data: EditionData) -> None:
    existing = first_import(data)

    result = run(existing, with_patch(data, "99.1"), now=T1, force=True)

    assert [(c.kind, c.applied, c.reason) for c in result.changes] == [
        ("modified", True, "--force")
    ]


def test_provisional_records_update_freely(data: EditionData) -> None:
    live = EditionData.from_records(data.records())
    live.edition = live.edition.model_copy(update={"status": "live"})
    existing = first_import(live)
    incoming = with_patch(live, "99.1")

    result = run(existing, incoming, now=T1)

    assert [(c.kind, c.applied) for c in result.changes] == [("modified", True)]


def test_records_missing_from_provider_are_kept(data: EditionData) -> None:
    existing = first_import(data)
    shrunk = EditionData.from_records(data.records())
    removed = shrunk.placements.pop()

    result = run(existing, shrunk, now=T1)

    assert [(c.kind, c.applied) for c in result.changes] == [("removed", False)]
    assert f"placement:{removed.team}" in result.records
