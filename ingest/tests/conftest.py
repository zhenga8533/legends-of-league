import copy
import json
import shutil
from pathlib import Path

import pytest

from lol_ingest.identity import EntityStore
from lol_ingest.paths import DATA_DIR
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.registry import EditionSpec, load_registry

FIXTURES = Path(__file__).parent / "fixtures"
_SUBSET = json.loads((FIXTURES / "leaguepedia" / "worlds-2024-subset.json").read_text("utf-8"))


@pytest.fixture
def snapshot() -> Snapshot:
    return Snapshot(copy.deepcopy(_SUBSET))


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """A data directory with the real registry and curated seed entities, but no imports."""
    target = tmp_path / "data"
    (target / "entities").mkdir(parents=True)
    shutil.copy(DATA_DIR / "editions.yaml", target / "editions.yaml")
    for name in ("regions.json", "tournaments.json"):
        shutil.copy(DATA_DIR / "entities" / name, target / "entities" / name)
    return target


@pytest.fixture
def spec(data_dir: Path) -> EditionSpec:
    return load_registry(data_dir).select("worlds", "2024")[0]


@pytest.fixture
def store(data_dir: Path) -> EntityStore:
    return EntityStore.load(data_dir)
