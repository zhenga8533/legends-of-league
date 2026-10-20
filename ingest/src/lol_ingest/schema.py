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


def canonical_json_schema() -> dict[str, Any]:
    _, schema = models_json_schema(
        [(model, "validation") for model in CANONICAL_MODELS],
        title=SCHEMA_TITLE,
        schema_generator=_NoFieldTitles,
    )
    return schema


def render_schema() -> str:
    # Stable formatting so regenerating with unchanged models yields no git diff.
    return json.dumps(canonical_json_schema(), indent=2, ensure_ascii=False) + "\n"
