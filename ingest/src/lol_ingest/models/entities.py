import datetime as dt
from typing import Literal

from pydantic import Field

from lol_ingest.models.common import (
    CanonicalModel,
    DateRange,
    ExternalRef,
    OrgId,
    PlayerId,
    RegionId,
    TeamId,
    TournamentId,
)


class Region(CanonicalModel):
    """A competitive region during one era. Splits and merges (e.g. NA + BR + LAT into LTA)
    are modelled as separate regions linked by predecessors/successors, so historical
    records keep pointing at the region that existed at the time."""

    id: RegionId
    name: str
    abbreviation: str
    active: DateRange
    predecessors: list[RegionId] = []
    successors: list[RegionId] = []
    external_refs: list[ExternalRef] = []


class OrgLink(CanonicalModel):
    """Relationship to another organization, e.g. KSV acquiring Samsung Galaxy's spot."""

    org: OrgId
    relation: Literal["acquisition", "merger", "spin-off"]
    date: dt.date | None = None
    note: str | None = None


class Organization(CanonicalModel):
    """The persistent organization behind one or more team identities."""

    id: OrgId
    name: str = Field(description="Canonical display name; historical names live on TeamIdentity.")
    lineage: list[OrgLink] = []
    external_refs: list[ExternalRef] = []


class TeamIdentity(CanonicalModel):
    """How an organization appeared over a period: name, tag and region (SKT T1 -> T1)."""

    id: TeamId
    org: OrgId
    name: str
    short_name: str | None = Field(default=None, description="Tag, e.g. 'BLG'; unknown for some.")
    region: RegionId
    active: DateRange
    external_refs: list[ExternalRef] = []


class PlayerHandle(CanonicalModel):
    handle: str
    active: DateRange


class Player(CanonicalModel):
    id: PlayerId
    handles: list[PlayerHandle] = Field(min_length=1)
    real_name: str | None = None
    native_name: str | None = None
    country: str | None = Field(
        default=None, pattern=r"^[A-Z]{2}$", description="ISO 3166-1 alpha-2."
    )
    external_refs: list[ExternalRef] = []


class Tournament(CanonicalModel):
    """A tournament series such as Worlds; individual years are editions."""

    id: TournamentId
    name: str
    short_name: str
    active: DateRange
    external_refs: list[ExternalRef] = []
