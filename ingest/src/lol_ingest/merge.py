"""Merge freshly normalized records into the committed edition without silently overwriting.

- New records are added.
- Changed records are applied only if they are not yet verified (or with --force).
- Records the provider no longer returns are kept unless --force is given.
"""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from lol_ingest.edition_data import EditionData
from lol_ingest.jsonio import to_json_data
from lol_ingest.models import Gap, Provenance, ProvenanceRecord
from lol_ingest.models.common import Provider
from lol_ingest.models.edition import RecordStatus

ChangeKind = Literal["added", "modified", "removed"]


@dataclass(frozen=True)
class Change:
    key: str
    kind: ChangeKind
    applied: bool
    reason: str = ""


@dataclass
class MergeResult:
    records: dict[str, BaseModel]
    provenance: Provenance
    changes: list[Change] = field(default_factory=list)
    unchanged: int = 0

    @property
    def applied(self) -> list[Change]:
        return [change for change in self.changes if change.applied]

    @property
    def blocked(self) -> list[Change]:
        return [change for change in self.changes if not change.applied]


def content_hash(record: BaseModel) -> str:
    encoded = json.dumps(to_json_data(record), sort_keys=True, ensure_ascii=False).encode()
    # 64 bits is ample for spotting changed records and keeps provenance files small.
    return hashlib.sha256(encoded).hexdigest()[:16]


def merge(
    existing: tuple[EditionData, Provenance] | None,
    incoming: EditionData,
    *,
    refs: dict[str, str],
    gaps: list[Gap],
    provider: Provider,
    run_id: str,
    force: bool,
) -> MergeResult:
    status: RecordStatus = "verified" if incoming.edition.status == "completed" else "provisional"
    old_records = existing[0].records() if existing else {}
    old_provenance = {record.key: record for record in existing[1].records} if existing else {}
    new_records = incoming.records()

    def provenance_for(key: str, record: BaseModel) -> ProvenanceRecord:
        return ProvenanceRecord(
            key=key,
            provider=provider,
            ref=refs.get(key, ""),
            hash=content_hash(record),
            import_run=run_id,
            status=status,
        )

    merged: dict[str, BaseModel] = {}
    provenance: dict[str, ProvenanceRecord] = {}
    result = MergeResult(records=merged, provenance=Provenance())

    for key in sorted(old_records.keys() | new_records.keys()):
        old, new = old_records.get(key), new_records.get(key)
        # Records with no provenance were curated by hand, so they are treated as verified.
        old_prov = old_provenance.get(key)
        old_verified = old is not None and (old_prov is None or old_prov.status == "verified")

        if old is None and new is not None:
            merged[key], provenance[key] = new, provenance_for(key, new)
            result.changes.append(Change(key, "added", applied=True))
        elif new is None and old is not None:
            if force:
                result.changes.append(Change(key, "removed", applied=True, reason="--force"))
            else:
                merged[key] = old
                if old_prov:
                    provenance[key] = old_prov
                result.changes.append(
                    Change(key, "removed", applied=False, reason="no longer returned by provider")
                )
        elif old is not None and new is not None:
            if content_hash(old) == content_hash(new):
                merged[key] = old
                keep = old_prov or provenance_for(key, old)
                if keep.status == "provisional" and status == "verified":
                    keep = keep.model_copy(update={"status": "verified", "import_run": run_id})
                provenance[key] = keep
                result.unchanged += 1
            elif old_verified and not force:
                merged[key] = old
                if old_prov:
                    provenance[key] = old_prov
                result.changes.append(
                    Change(key, "modified", applied=False, reason="record is verified")
                )
            else:
                merged[key], provenance[key] = new, provenance_for(key, new)
                reason = "--force" if old_verified else ""
                result.changes.append(Change(key, "modified", applied=True, reason=reason))

    result.provenance = Provenance(
        gaps=sorted(gaps, key=lambda gap: (gap.record, gap.reason)),
        records=[provenance[key] for key in sorted(provenance)],
    )
    return result
