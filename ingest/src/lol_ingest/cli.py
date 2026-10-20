import argparse
from pathlib import Path

from lol_ingest.schema import render_schema


def _schema_export(args: argparse.Namespace) -> None:
    out: Path = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_schema(), encoding="utf-8", newline="\n")
    print(f"Wrote {out}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lol-ingest",
        description="Fetch, normalize and validate Legends of League tournament data.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    schema = commands.add_parser("schema", help="Canonical data schema tools.")
    schema_commands = schema.add_subparsers(dest="schema_command", required=True)
    export = schema_commands.add_parser("export", help="Write the canonical JSON Schema.")
    export.add_argument("--out", type=Path, required=True, help="Output .json path.")
    export.set_defaults(handler=_schema_export)

    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.handler(args)
