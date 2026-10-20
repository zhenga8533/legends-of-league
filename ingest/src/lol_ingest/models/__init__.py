from lol_ingest.models.common import DateRange, ExternalRef
from lol_ingest.models.entities import (
    Organization,
    OrgLink,
    Player,
    PlayerHandle,
    Region,
    TeamIdentity,
    Tournament,
)

# Top-level records exported to JSON Schema / TypeScript; nested models come along as $defs.
CANONICAL_MODELS = (Region, Organization, TeamIdentity, Player, Tournament)

__all__ = [
    "CANONICAL_MODELS",
    "DateRange",
    "ExternalRef",
    "OrgLink",
    "Organization",
    "Player",
    "PlayerHandle",
    "Region",
    "TeamIdentity",
    "Tournament",
]
