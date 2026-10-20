from datetime import date
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

_SLUG = r"[a-z0-9]+(?:-[a-z0-9]+)*"


def _id_pattern(prefix: str) -> str:
    return rf"^{prefix}:{_SLUG}$"


# Canonical IDs are minted by us and never derived from a provider's row IDs or from display
# names at query time: Leaguepedia regenerates Cargo row IDs, and teams/players rename.
RegionId = Annotated[str, Field(pattern=_id_pattern("region"))]
OrgId = Annotated[str, Field(pattern=_id_pattern("org"))]
TeamId = Annotated[str, Field(pattern=_id_pattern("team"))]
PlayerId = Annotated[str, Field(pattern=_id_pattern("player"))]
TournamentId = Annotated[str, Field(pattern=_id_pattern("tour"))]

Provider = Literal["leaguepedia", "lolesports"]


class CanonicalModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class ExternalRef(CanonicalModel):
    """A provider's identifier for a canonical record, e.g. a Leaguepedia OverviewPage."""

    provider: Provider
    key: str = Field(description="Provider field the value comes from, e.g. 'OverviewPage'.")
    value: str


class DateRange(CanonicalModel):
    """Inclusive date range; a missing bound means unknown or still ongoing."""

    start: date | None = None
    end: date | None = None

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.start and self.end and self.end < self.start:
            raise ValueError(f"end {self.end} is before start {self.start}")
        return self
