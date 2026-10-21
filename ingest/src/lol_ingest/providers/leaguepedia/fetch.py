"""Fetch everything Leaguepedia has about one edition into a single raw snapshot."""

import hashlib
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Protocol

from lol_ingest.providers.leaguepedia.client import Row
from lol_ingest.registry import EditionSpec

MATCH_FIELDS = (
    "OverviewPage", "Tab", "N_MatchInTab", "Team1", "Team2", "Winner", "Team1Score",
    "Team2Score", "BestOf", "FF", "IsTiebreaker", "IsNullified", "DateTime_UTC", "Patch", "MVP",
    "MatchId",
)  # fmt: skip
GAME_FIELDS = (
    "OverviewPage", "MatchId", "GameId", "N_GameInMatch", "Team1", "Team2", "Winner",
    "DateTime_UTC", "Gamelength", "Patch", "RiotPlatformGameId",
)  # fmt: skip
DRAFT_FIELDS = (
    "GameId", "Team1", "Team2",
    *(f"Team{team}{kind}{n}" for team in (1, 2) for kind in ("Ban", "Pick") for n in range(1, 6)),
)  # fmt: skip
PLAYER_STAT_FIELDS = (
    "GameId", "Team", "Link", "Side", "Role", "Champion", "Kills", "Deaths", "Assists", "Gold",
    "CS", "DamageToChampions", "VisionScore", "SummonerSpells", "Items", "Trinket",
    "KeystoneRune", "KeystoneMastery", "PrimaryTree", "SecondaryTree", "Runes",
)  # fmt: skip
ROSTER_FIELDS = ("OverviewPage", "Team", "Short", "Region")
ROSTER_PLAYER_FIELDS = ("OverviewPage", "Team", "Link", "Role")
RESULT_FIELDS = ("OverviewPage", "Team", "Place", "Prize_USD", "Showmatch")
TOURNAMENT_FIELDS = ("OverviewPage", "Name", "DateStart", "Date")
TEAM_FIELDS = ("OverviewPage", "Name", "Short", "OrganizationPage")
PLAYER_REDIRECT_FIELDS = ("AllName", "OverviewPage")
PLAYER_FIELDS = ("OverviewPage", "ID", "Name", "NativeName", "Country")

IN_CHUNK = 50  # keeps generated URLs comfortably short


class Client(Protocol):
    def query(
        self, tables: str, fields: Sequence[str], *, where: str = "", order_by: str = ""
    ) -> list[Row]: ...


@dataclass(frozen=True)
class Snapshot:
    """Raw Leaguepedia rows for one edition, keyed by query name."""

    tables: dict[str, list[Row]]

    def sha256(self) -> str:
        encoded = json.dumps(self.tables, sort_keys=True, ensure_ascii=False).encode()
        return hashlib.sha256(encoded).hexdigest()


def page_title(name: str) -> str:
    """Normalize a wiki link to its page title: MediaWiki treats underscores as spaces and
    upper-cases the first letter, so 'paiN Gaming' links to the page 'PaiN Gaming'."""
    title = " ".join(name.replace("_", " ").split())
    return title[:1].upper() + title[1:]


def quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def in_clause(field: str, values: Iterable[str]) -> str:
    return f"{field} IN ({','.join(quote(value) for value in values)})"


def _chunked_query(
    client: Client, table: str, fields: Sequence[str], field: str, values: Iterable[str]
) -> list[Row]:
    ordered = sorted(set(values))
    rows: list[Row] = []
    for start in range(0, len(ordered), IN_CHUNK):
        chunk = ordered[start : start + IN_CHUNK]
        rows += client.query(table, fields, where=in_clause(field, chunk), order_by=field)
    return rows


def fetch_edition(client: Client, spec: EditionSpec) -> Snapshot:
    pages = [page.page for page in spec.leaguepedia.pages]
    on_pages = in_clause("OverviewPage", pages)

    def by_pages(table: str, fields: Sequence[str], order_by: str) -> list[Row]:
        return client.query(table, fields, where=on_pages, order_by=order_by)

    tables: dict[str, list[Row]] = {
        "tournaments": by_pages("Tournaments", TOURNAMENT_FIELDS, "OverviewPage"),
        "matches": by_pages("MatchSchedule", MATCH_FIELDS, "MatchId"),
        "games": by_pages("ScoreboardGames", GAME_FIELDS, "GameId"),
        "drafts": by_pages("PicksAndBansS7", DRAFT_FIELDS, "GameId"),
        "playerStats": by_pages("ScoreboardPlayers", PLAYER_STAT_FIELDS, "GameId,Side,Role_Number"),
        "rosters": by_pages("TournamentRosters", ROSTER_FIELDS, "OverviewPage,Team"),
        "rosterPlayers": by_pages(
            "TournamentPlayers", ROSTER_PLAYER_FIELDS, "OverviewPage,Team,N_PlayerInTeam"
        ),
        "results": client.query(
            "TournamentResults",
            RESULT_FIELDS,
            where=f"OverviewPage={quote(spec.leaguepedia.base_page)}",
            order_by="Place_Number,Team",
        ),
    }

    team_names = {
        page_title(row[key])
        for table, keys in (("matches", ("Team1", "Team2")), ("rosters", ("Team",)))
        for row in tables[table]
        for key in keys
        if row[key]
    }
    tables["teams"] = _chunked_query(client, "Teams", TEAM_FIELDS, "OverviewPage", team_names)

    player_links = {
        page_title(row["Link"])
        for table in ("playerStats", "rosterPlayers")
        for row in tables[table]
        if row["Link"]
    } | {page_title(row["MVP"]) for row in tables["matches"] if row["MVP"] not in ("", "N/A")}
    redirects = _chunked_query(
        client, "PlayerRedirects", PLAYER_REDIRECT_FIELDS, "AllName", player_links
    )
    tables["playerRedirects"] = redirects
    canonical_pages = {row["OverviewPage"] for row in redirects} | player_links
    tables["players"] = _chunked_query(
        client, "Players", PLAYER_FIELDS, "OverviewPage", canonical_pages
    )
    return Snapshot(tables)
