import json
from typing import Any

from pydantic.json_schema import GenerateJsonSchema, models_json_schema
from pydantic_core import CoreSchema

from lol_ingest.models import CANONICAL_MODELS

SCHEMA_TITLE = "LegendsOfLeagueCanonical"


class _NoFieldTitles(GenerateJsonSchema):
    # json-schema-to-typescript turns every titled property into a named type alias
    # (Id1, Id2, Date, ...), which pollutes the generated TS and can shadow globals.
    def field_title_should_be_set(self, schema: CoreSchema) -> bool:
        return False


def _draft7_tuples(node: Any) -> Any:
    # Pydantic emits tuples as 2020-12 `prefixItems`, which json-schema-to-typescript renders
    # as [unknown, unknown]; the draft-07 `items: [...]` form gives properly typed tuples.
    if isinstance(node, dict):
        if "prefixItems" in node:
            node["items"] = node.pop("prefixItems")
        return {key: _draft7_tuples(value) for key, value in node.items()}
    if isinstance(node, list):
        return [_draft7_tuples(item) for item in node]
    return node


def canonical_json_schema() -> dict[str, Any]:
    _, schema = models_json_schema(
        [(model, "validation") for model in CANONICAL_MODELS],
        title=SCHEMA_TITLE,
        schema_generator=_NoFieldTitles,
    )
    result: dict[str, Any] = _draft7_tuples(schema)
    return result


def render_schema() -> str:
    # Stable formatting so regenerating with unchanged models yields no git diff.
    return json.dumps(canonical_json_schema(), indent=2, ensure_ascii=False) + "\n"
