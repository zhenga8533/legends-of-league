from typing import Literal, Self

from pydantic import AwareDatetime, Field, model_validator

from lol_ingest.models.common import (
    CanonicalModel,
    DateRange,
    EditionId,
    ExternalRef,
    GameId,
    PlayerId,
    Provider,
    RegionId,
    SeriesId,
    StageId,
    TeamId,
    TournamentId,
)

EditionStatus = Literal["upcoming", "live", "completed"]
Side = Literal["blue", "red"]
Role = Literal["top", "jungle", "mid", "bot", "support"]
RosterRole = Literal["top", "jungle", "mid", "bot", "support", "coach"]
RecordStatus = Literal["verified", "provisional"]


class Stage(CanonicalModel):
    id: StageId
    name: str


class Participant(CanonicalModel):
    team: TeamId
    region: RegionId = Field(description="The team's region at the time of this edition.")
    entry_stage: StageId


class Edition(CanonicalModel):
    id: EditionId
    tournament: TournamentId
    year: int
    name: str
    status: EditionStatus
    dates: DateRange
    stages: list[Stage]
    participants: list[Participant]
    external_refs: list[ExternalRef] = []


class Series(CanonicalModel):
    """A match between two teams: one Bo1 game, or a Bo3/Bo5 set of games."""

    id: SeriesId
    stage: StageId
    round: str = Field(description="Round label within the stage, e.g. 'Round 3', 'Finals'.")
    number: int = Field(ge=1, description="Order of the series within its round.")
    best_of: int = Field(ge=1, le=7)
    teams: tuple[TeamId, TeamId]
    score: tuple[int, int] | None = None
    winner: TeamId | None = None
    forfeit: bool = False
    tiebreaker: bool = False
    start: AwareDatetime | None = None
    patch: str | None = None
    mvp: PlayerId | None = None
    external_refs: list[ExternalRef] = []

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.teams[0] == self.teams[1]:
            raise ValueError(f"{self.id}: a team cannot play itself")
        if self.winner is not None and self.winner not in self.teams:
            raise ValueError(f"{self.id}: winner {self.winner} is not one of the teams")
        return self


class TeamDraft(CanonicalModel):
    bans: list[str | None] = Field(description="Champion bans in draft order; null = no ban.")
    picks: list[str] = Field(description="Champion picks in draft order.")


class Draft(CanonicalModel):
    blue: TeamDraft
    red: TeamDraft


class Game(CanonicalModel):
    id: GameId
    series: SeriesId
    number: int = Field(ge=1)
    blue: TeamId
    red: TeamId
    winner: TeamId
    duration_seconds: int | None = Field(default=None, ge=0)
    patch: str | None = None
    start: AwareDatetime | None = None
    draft: Draft | None = None
    external_refs: list[ExternalRef] = []

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.blue == self.red:
            raise ValueError(f"{self.id}: blue and red are the same team")
        if self.winner not in (self.blue, self.red):
            raise ValueError(f"{self.id}: winner {self.winner} did not play")
        return self


class PlayerGameStats(CanonicalModel):
    game: GameId
    team: TeamId
    player: PlayerId
    side: Side
    role: Role
    champion: str
    kills: int = Field(ge=0)
    deaths: int = Field(ge=0)
    assists: int = Field(ge=0)
    gold: int | None = Field(default=None, ge=0)
    cs: int | None = Field(default=None, ge=0)
    damage_to_champions: int | None = Field(default=None, ge=0)
    vision_score: int | None = Field(default=None, ge=0)
    summoner_spells: list[str] = []
    items: list[str] = []
    trinket: str | None = None
    keystone: str | None = None
    primary_tree: str | None = None
    secondary_tree: str | None = None
    runes: list[str] = []


class RosterEntry(CanonicalModel):
    team: TeamId
    player: PlayerId
    role: RosterRole


class Placement(CanonicalModel):
    team: TeamId
    place_from: int = Field(ge=1)
    place_to: int = Field(ge=1, description="Equal to place_from unless the place is shared.")
    prize_usd: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.place_to < self.place_from:
            raise ValueError(
                f"{self.team}: place_to {self.place_to} < place_from {self.place_from}"
            )
        return self


class ProvenanceRecord(CanonicalModel):
    key: str = Field(description="Record key, e.g. 'series:ser:worlds-2024-swiss-round-1-01'.")
    provider: Provider
    ref: str = Field(description="Provider identifier of the source row(s).")
    hash: str = Field(description="Truncated SHA-256 of the normalized record.")
    import_run: str = Field(description="Run that last wrote the record; see data/_meta.")
    status: RecordStatus


class Gap(CanonicalModel):
    """Data the edition should have but the provider does not supply."""

    record: str
    reason: str


class Provenance(CanonicalModel):
    gaps: list[Gap] = []
    records: list[ProvenanceRecord] = []
