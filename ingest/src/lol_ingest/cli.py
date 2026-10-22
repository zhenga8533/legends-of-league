import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from lol_ingest.identity import EntityStore
from lol_ingest.lineage import apply_lineage, fetch_renames
from lol_ingest.lineage import render_markdown as render_lineage
from lol_ingest.paths import CACHE_DIR, DATA_DIR
from lol_ingest.pipeline import Fetch, RunOptions, UsageError, run
from lol_ingest.providers.leaguepedia.client import CargoClient, LeaguepediaError
from lol_ingest.providers.leaguepedia.fetch import Snapshot, fetch_edition
from lol_ingest.registry import EditionSpec
from lol_ingest.report import render_json, render_markdown
from lol_ingest.schema import render_schema

OPERATIONS = ("import", "refresh", "validate", "dry-run")


def _schema_export(args: argparse.Namespace) -> int:
    out: Path = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_schema(), encoding="utf-8", newline="\n")
    print(f"Wrote {out}")
    return 0


def _client(cache_dir: Path | None) -> CargoClient:
    return CargoClient(
        os.environ.get("LEAGUEPEDIA_BOT_USER", ""),
        os.environ.get("LEAGUEPEDIA_BOT_PASSWORD", ""),
        cache_dir=cache_dir,
    )


def _leaguepedia_fetcher(cache_dir: Path) -> Fetch:
    clients: dict[bool, CargoClient] = {}

    def fetch(spec: EditionSpec, use_cache: bool) -> Snapshot:
        if use_cache not in clients:
            clients[use_cache] = _client(cache_dir if use_cache else None)
        return fetch_edition(clients[use_cache], spec)

    return fetch


def _run(args: argparse.Namespace) -> int:
    options = RunOptions(
        operation=args.op,
        tournament=args.tournament,
        year=args.year,
        data_dir=args.data_dir,
        force=args.force,
        status=args.status,
    )
    try:
        reports = run(options, _leaguepedia_fetcher(args.cache_dir), datetime.now(UTC))
    except (UsageError, LeaguepediaError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    if not reports:
        print("No live editions; nothing to do.")
    markdown = render_markdown(reports)
    summary = render_json(reports)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    (args.report_dir / "report.md").write_text(markdown, encoding="utf-8")
    (args.report_dir / "report.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(markdown)
    print(f"Reports written to {args.report_dir}")
    return 0 if summary["ok"] else 1


def _lineage(args: argparse.Namespace) -> int:
    store = EntityStore.load(args.data_dir)
    pages = [
        ref.value
        for team in store.teams.values()
        for ref in team.external_refs
        if (ref.provider, ref.key) == ("leaguepedia", "OverviewPage")
    ]
    try:
        renames = fetch_renames(_client(None), pages)
    except LeaguepediaError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    report = apply_lineage(store, renames)
    if args.write and report.changed:
        store.save(args.data_dir)
    markdown = render_lineage(report)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    (args.report_dir / "report.md").write_text(markdown, encoding="utf-8")
    # Same shape as an import report, so the import workflow can open the PR the same way.
    summary = {
        "ok": True,
        "editions": [{"provider": "leaguepedia"}],
        "forced": 0,
        "blocked": 0,
        "autoMergeSafe": False,
    }
    (args.report_dir / "report.json").write_text(json.dumps(summary, indent=2) + "\n", "utf-8")
    print(markdown)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lol-ingest",
        description="Fetch, normalize and validate Legends of League tournament data.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    run_cmd = commands.add_parser(
        "run",
        help="Import, refresh, validate or dry-run editions.",
        description=(
            "import: fetch (using the local response cache) and write changes. "
            "refresh: like import, but always re-fetch. "
            "validate: check committed data offline. "
            "dry-run: everything except writing."
        ),
    )
    run_cmd.add_argument("--tournament", default="all", help="worlds, msi, first-stand or all")
    run_cmd.add_argument("--year", default="all", help="a year such as 2024, or all")
    run_cmd.add_argument(
        "--status",
        choices=("all", "live", "completed", "upcoming"),
        default="all",
        help="only editions with this registry status (the live sync uses 'live')",
    )
    run_cmd.add_argument("--op", choices=OPERATIONS, default="dry-run")
    run_cmd.add_argument(
        "--provider",
        choices=("auto", "leaguepedia"),
        default="auto",
        help="auto currently means leaguepedia",
    )
    run_cmd.add_argument(
        "--force",
        action="store_true",
        help="apply changes to verified records and removals (always review the result)",
    )
    run_cmd.add_argument("--data-dir", type=Path, default=DATA_DIR)
    run_cmd.add_argument("--cache-dir", type=Path, default=CACHE_DIR / "leaguepedia")
    run_cmd.add_argument("--report-dir", type=Path, default=CACHE_DIR / "reports")
    run_cmd.set_defaults(handler=_run)

    lineage = commands.add_parser(
        "lineage",
        help="Group team identities into organizations from Leaguepedia's renames.",
        description=(
            "Renames and rebrands put team identities under one organization; acquisitions "
            "link organizations. Always re-fetches. Without --write, only reports."
        ),
    )
    lineage.add_argument("--write", action="store_true", help="write the changes to data/")
    lineage.add_argument("--data-dir", type=Path, default=DATA_DIR)
    lineage.add_argument("--report-dir", type=Path, default=CACHE_DIR / "reports")
    lineage.set_defaults(handler=_lineage)

    schema = commands.add_parser("schema", help="Canonical data schema tools.")
    schema_commands = schema.add_subparsers(dest="schema_command", required=True)
    export = schema_commands.add_parser("export", help="Write the canonical JSON Schema.")
    export.add_argument("--out", type=Path, required=True, help="Output .json path.")
    export.set_defaults(handler=_schema_export)

    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    sys.exit(args.handler(args))
