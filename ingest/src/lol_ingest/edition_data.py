"""An edition's full record set, its stable record keys, and its on-disk layout."""

import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from lol_ingest.jsonio import (
    dumps_document,
    dumps_records,
    dumps_sections,
    read_document,
    read_records,
)
from lol_ingest.models import (
    Edition,
    Game,
    Placement,
    PlayerGameStats,
    Provenance,
    RosterEntry,
    Series,
)

Record = Edition | Series | Game | PlayerGameStats | RosterEntry | Placement

LIST_FILES: dict[str, type[BaseModel]] = {
    "series.json": Series,
    "games.json": Game,
    "player-stats.json": PlayerGameStats,
    "rosters.json": RosterEntry,
    "results.json": Placement,
}


@dataclass(frozen=True)
class Issue:
    level: Literal["error", "warning"]
    code: str
    message: str


def record_key(record: BaseModel) -> str:
    """A key that stays the same when a provider re-sends the same real-world record."""
    match record:
        case Edition():
            return f"edition:{record.id}"
        case Series():
            return f"series:{record.id}"
        case Game():
            return f"game:{record.id}"
        case PlayerGameStats():
            return f"stats:{record.game}/{record.player}"
        case RosterEntry():
            return f"roster:{record.team}/{record.player}/{record.role}"
        case Placement():
            return f"placement:{record.team}"
    raise TypeError(f"not an edition record: {type(record).__name__}")


@dataclass
class EditionData:
    edition: Edition
    series: list[Series] = field(default_factory=list)
    games: list[Game] = field(default_factory=list)
    player_stats: list[PlayerGameStats] = field(default_factory=list)
    rosters: list[RosterEntry] = field(default_factory=list)
    placements: list[Placement] = field(default_factory=list)

    def records(self) -> dict[str, BaseModel]:
        items: list[BaseModel] = [
            self.edition,
            *self.series,
            *self.games,
            *self.player_stats,
            *self.rosters,
            *self.placements,
        ]
        return {record_key(record): record for record in items}

    @classmethod
    def from_records(cls, records: dict[str, BaseModel]) -> "EditionData":
        ordered = [records[key] for key in sorted(records)]
        editions = [r for r in ordered if isinstance(r, Edition)]
        if len(editions) != 1:
            raise ValueError(f"expected exactly one edition record, found {len(editions)}")
        return cls(
            edition=editions[0],
            series=[r for r in ordered if isinstance(r, Series)],
            games=[r for r in ordered if isinstance(r, Game)],
            player_stats=[r for r in ordered if isinstance(r, PlayerGameStats)],
            rosters=[r for r in ordered if isinstance(r, RosterEntry)],
            placements=[r for r in ordered if isinstance(r, Placement)],
        )


def load_edition(directory: Path) -> tuple[EditionData, Provenance] | None:
    if not (directory / "edition.json").exists():
        return None
    lists = {name: read_records(directory / name, model) for name, model in LIST_FILES.items()}
    data = EditionData(
        edition=read_document(directory / "edition.json", Edition),
        series=lists["series.json"],  # type: ignore[arg-type]
        games=lists["games.json"],  # type: ignore[arg-type]
        player_stats=lists["player-stats.json"],  # type: ignore[arg-type]
        rosters=lists["rosters.json"],  # type: ignore[arg-type]
        placements=lists["results.json"],  # type: ignore[arg-type]
    )
    return data, read_document(directory / "provenance.json", Provenance)


def save_edition(directory: Path, data: EditionData, provenance: Provenance) -> None:
    """Write the edition into a fresh sibling directory, then swap it into place, so a crash
    mid-write never leaves a half-updated edition behind."""
    files = {
        "edition.json": dumps_document(data.edition),
        "series.json": dumps_records(data.series),
        "games.json": dumps_records(data.games),
        "player-stats.json": dumps_records(data.player_stats),
        "rosters.json": dumps_records(data.rosters),
        "results.json": dumps_records(data.placements),
        "provenance.json": dumps_sections({"gaps": provenance.gaps, "records": provenance.records}),
    }
    directory.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{directory.name}.", dir=directory.parent))
    try:
        for name, text in files.items():
            (staging / name).write_text(text, encoding="utf-8", newline="\n")
        backup = directory.with_name(f".{directory.name}.old")
        shutil.rmtree(backup, ignore_errors=True)
        if directory.exists():
            directory.rename(backup)
        try:
            staging.rename(directory)
        except BaseException:
            if backup.exists():
                backup.rename(directory)
            raise
        shutil.rmtree(backup, ignore_errors=True)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
