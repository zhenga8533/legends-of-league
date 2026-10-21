"""Import summaries, rendered as Markdown (PR body) and JSON (for workflows)."""

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from lol_ingest.edition_data import Issue
from lol_ingest.merge import MergeResult
from lol_ingest.models import Gap

RECORD_TYPES = ("edition", "series", "game", "stats", "roster", "placement")


@dataclass
class EditionReport:
    edition: str
    operation: str
    provider: str | None = None
    snapshot_sha256: str | None = None
    merge: MergeResult | None = None
    issues: list[Issue] = field(default_factory=list)
    gaps: list[Gap] = field(default_factory=list)
    new_entities: list[str] = field(default_factory=list)
    files_changed: bool = False

    @property
    def errors(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.level == "warning"]

    def counts(self) -> dict[str, dict[str, int]]:
        table = {kind: Counter[str]() for kind in RECORD_TYPES}
        if self.merge:
            for change in self.merge.changes:
                bucket = change.kind if change.applied else "blocked"
                table[change.key.split(":", 1)[0]][bucket] += 1
        return {kind: dict(counter) for kind, counter in table.items()}


def _details(summary: str, lines: list[str], limit: int = 200) -> str:
    shown = lines[:limit]
    if len(lines) > limit:
        shown.append(f"… and {len(lines) - limit} more")
    body = "\n".join(f"- {line}" for line in shown)
    return f"<details><summary>{summary}</summary>\n\n{body}\n\n</details>\n"


def render_markdown(reports: list[EditionReport]) -> str:
    out: list[str] = []
    for report in reports:
        out.append(f"## {report.edition}: {report.operation}")
        meta = [f"provider `{report.provider}`"] if report.provider else []
        if report.snapshot_sha256:
            meta.append(f"snapshot `{report.snapshot_sha256[:12]}`")
        meta.append("**files changed**" if report.files_changed else "no file changes")
        out.append(" · ".join(meta) + "\n")

        if report.merge:
            out.append("| Records | Added | Modified | Removed | Blocked | Unchanged* |")
            out.append("| --- | ---: | ---: | ---: | ---: | ---: |")
            for kind, counts in report.counts().items():
                cells = [counts.get(k, 0) for k in ("added", "modified", "removed", "blocked")]
                out.append(f"| {kind} | " + " | ".join(map(str, cells)) + " | |")
            out.append(f"\n\\*Unchanged records in total: {report.merge.unchanged}\n")
            if report.merge.blocked:
                out.append("### ⚠️ Blocked changes (need review)\n")
                out.append("Verified records are never overwritten silently. Re-run with `force`")
                out.append("only after confirming the provider's new data is correct.\n")
                out.append("| Record | Change | Reason |\n| --- | --- | --- |")
                out += [f"| `{c.key}` | {c.kind} | {c.reason} |" for c in report.merge.blocked]
                out.append("")
            forced = [c for c in report.merge.applied if c.reason == "--force"]
            if forced:
                out.append(
                    _details(
                        f"Forced changes ({len(forced)})", [f"`{c.key}` {c.kind}" for c in forced]
                    )
                )

        if report.errors:
            out.append(f"### ❌ Errors ({len(report.errors)}), nothing was written\n")
            out += [f"- `{issue.code}` {issue.message}" for issue in report.errors]
            out.append("")
        if report.new_entities:
            out.append(
                _details(
                    f"New entities to review ({len(report.new_entities)})",
                    [f"`{e}`" for e in report.new_entities],
                )
            )
        if report.gaps:
            out.append(
                _details(
                    f"Known gaps ({len(report.gaps)})",
                    [f"`{g.record}` {g.reason}" for g in report.gaps],
                )
            )
        if report.warnings:
            out.append(
                _details(
                    f"Warnings ({len(report.warnings)})",
                    [f"`{w.code}` {w.message}" for w in report.warnings],
                )
            )
    return "\n".join(out).rstrip() + "\n"


def render_json(reports: list[EditionReport]) -> dict[str, Any]:
    return {
        "ok": not any(report.errors for report in reports),
        "filesChanged": any(report.files_changed for report in reports),
        "blocked": sum(len(report.merge.blocked) for report in reports if report.merge),
        "forced": sum(
            1
            for report in reports
            if report.merge
            for change in report.merge.applied
            if change.reason == "--force"
        ),
        "editions": [
            {
                "edition": report.edition,
                "operation": report.operation,
                "provider": report.provider,
                "snapshotSha256": report.snapshot_sha256,
                "filesChanged": report.files_changed,
                "counts": report.counts(),
                "unchanged": report.merge.unchanged if report.merge else 0,
                "blocked": [
                    {"key": c.key, "kind": c.kind, "reason": c.reason}
                    for c in (report.merge.blocked if report.merge else [])
                ],
                "errors": [vars(issue) for issue in report.errors],
                "warnings": len(report.warnings),
                "gaps": len(report.gaps),
                "newEntities": report.new_entities,
            }
            for report in reports
        ],
    }
