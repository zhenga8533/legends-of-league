"""Deterministic JSON files: one record per line, so data PR diffs show one line per change."""

import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel, TypeAdapter


def to_json_data(model: BaseModel) -> dict[str, Any]:
    data: dict[str, Any] = model.model_dump(mode="json", by_alias=True, exclude_none=True)
    return data


def compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def dumps_records(records: Sequence[BaseModel]) -> str:
    if not records:
        return "[]\n"
    return "[\n" + ",\n".join(compact(to_json_data(record)) for record in records) + "\n]\n"


def dumps_sections(sections: dict[str, Sequence[BaseModel]]) -> str:
    """An object whose values are record lists, each record on its own line."""
    parts = []
    for name, records in sections.items():
        lines = ",\n".join(f"    {compact(to_json_data(record))}" for record in records)
        parts.append(f"  {json.dumps(name)}: [\n{lines}\n  ]" if records else f'  "{name}": []')
    return "{\n" + ",\n".join(parts) + "\n}\n"


def dumps_document(model: BaseModel) -> str:
    return json.dumps(to_json_data(model), ensure_ascii=False, indent=2) + "\n"


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def write_records(path: Path, records: Sequence[BaseModel]) -> None:
    write_text_atomic(path, dumps_records(records))


def read_records[M: BaseModel](path: Path, model: type[M]) -> list[M]:
    return TypeAdapter(list[model]).validate_json(path.read_bytes())  # type: ignore[valid-type]


def read_document[M: BaseModel](path: Path, model: type[M]) -> M:
    return model.model_validate_json(path.read_bytes())
