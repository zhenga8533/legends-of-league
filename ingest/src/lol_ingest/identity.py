"""Canonical entities and the lookups that map provider identifiers onto them."""

import copy
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from lol_ingest.jsonio import read_records, write_records
from lol_ingest.models import Organization, Player, Region, TeamIdentity, Tournament
from lol_ingest.models.common import ExternalRef, Provider

ENTITY_FILES: dict[str, type[BaseModel]] = {
    "regions": Region,
    "tournaments": Tournament,
    "organizations": Organization,
    "teams": TeamIdentity,
    "players": Player,
}

M = TypeVar("M", bound=BaseModel)


class IdentityError(ValueError):
    pass


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def strip_disambiguation(page: str) -> str:
    """'Bin (Chen Ze-Bin)' -> 'Bin'; wiki pages disambiguate same-named entities this way."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", page)


def _ref_key(ref: ExternalRef) -> tuple[str, str, str]:
    return (ref.provider, ref.key, ref.value)


@dataclass
class EntityStore:
    regions: dict[str, Region] = field(default_factory=dict)
    tournaments: dict[str, Tournament] = field(default_factory=dict)
    organizations: dict[str, Organization] = field(default_factory=dict)
    teams: dict[str, TeamIdentity] = field(default_factory=dict)
    players: dict[str, Player] = field(default_factory=dict)
    added: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, data_dir: Path) -> "EntityStore":
        store = cls()
        for name, model in ENTITY_FILES.items():
            path = data_dir / "entities" / f"{name}.json"
            records = read_records(path, model) if path.exists() else []
            getattr(store, name).update({getattr(r, "id"): r for r in records})  # noqa: B009
        return store

    def save(self, data_dir: Path) -> None:
        for name in ENTITY_FILES:
            entities: dict[str, BaseModel] = getattr(self, name)
            write_records(
                data_dir / "entities" / f"{name}.json",
                [entities[key] for key in sorted(entities)],
            )

    def checkpoint(self) -> dict[str, Any]:
        return {name: copy.copy(value) for name, value in vars(self).items()}

    def restore(self, checkpoint: dict[str, Any]) -> None:
        vars(self).update(checkpoint)

    def all_ids(self) -> set[str]:
        return {key for name in ENTITY_FILES for key in getattr(self, name)}

    def find(self, kind: str, provider: Provider, key: str, value: str) -> str | None:
        wanted = (provider, key, value)
        entities: dict[str, TeamIdentity | Player | Organization] = getattr(self, kind)
        return next(
            (
                entity_id
                for entity_id, entity in entities.items()
                if any(_ref_key(ref) == wanted for ref in entity.external_refs)
            ),
            None,
        )

    def region_for(self, provider: Provider, code: str, on: date | None) -> Region:
        matches = [
            region
            for region in self.regions.values()
            if any(_ref_key(ref) == (provider, "RegionCode", code) for ref in region.external_refs)
            and (on is None or region.active.start is None or region.active.start <= on)
            and (on is None or region.active.end is None or on <= region.active.end)
        ]
        if len(matches) != 1:
            found = [region.id for region in matches] or "none"
            raise IdentityError(
                f"region code {code!r} on {on} must match exactly one region in "
                f"data/entities/regions.json (found {found})"
            )
        return matches[0]

    def mint_id(self, prefix: str, name: str) -> str:
        base = slugify(name)
        if not base:
            raise IdentityError(f"cannot derive an ID from {name!r}")
        taken = self.all_ids()
        candidate, n = f"{prefix}:{base}", 2
        while candidate in taken:
            candidate, n = f"{prefix}:{base}-{n}", n + 1
        return candidate

    def add(self, kind: str, entity: M) -> M:
        entity_id = getattr(entity, "id")  # noqa: B009 - all entity models have an id
        getattr(self, kind)[entity_id] = entity
        self.added.add(entity_id)
        return entity
