import json
from pathlib import Path

from lol_ingest.cli import main
from lol_ingest.models import CANONICAL_MODELS
from lol_ingest.schema import render_schema


def test_schema_contains_every_canonical_model() -> None:
    defs = json.loads(render_schema())["$defs"]

    for model in CANONICAL_MODELS:
        assert model.__name__ in defs


def test_schema_uses_camel_case_property_names() -> None:
    team = json.loads(render_schema())["$defs"]["TeamIdentity"]

    assert "shortName" in team["properties"]
    assert "short_name" not in team["properties"]


def test_render_is_deterministic() -> None:
    assert render_schema() == render_schema()


def test_cli_export_writes_schema(tmp_path: Path) -> None:
    out = tmp_path / "nested" / "canonical.schema.json"

    main(["schema", "export", "--out", str(out)])

    assert out.read_text(encoding="utf-8") == render_schema()
