from pathlib import Path

# ingest/src/lol_ingest/paths.py -> repository root. The package is always installed in
# editable mode from the repo (uv sync), so this resolves to the checkout.
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"
RULESETS_DIR = REPO_ROOT / "rulesets"
CACHE_DIR = REPO_ROOT / ".cache"


def edition_dir(data_dir: Path, tournament: str, year: int) -> Path:
    return data_dir / "tournaments" / tournament / str(year)
