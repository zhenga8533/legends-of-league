"""Turn a raw Leaguepedia snapshot into canonical edition records.

Teams and players we have not seen before are proposed as new entities (they land in the
same pull request for review). Nothing is guessed: unknown values stay empty and are reported.
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from lol_ingest.edition_data import EditionData, Issue, record_key
from lol_ingest.identity import EntityStore, IdentityError, slugify, strip_disambiguation
from lol_ingest.models import (
    DateRange,
    Draft,
    Edition,
    ExternalRef,
    Game,
    Gap,
    Organization,
    Participant,
    Placement,
    Player,
    PlayerGameStats,
    PlayerHandle,
    RosterEntry,
    Series,
    TeamDraft,
    TeamIdentity,
)
from lol_ingest.models.common import Provider
from lol_ingest.models.edition import Role, RosterRole, Side
from lol_ingest.providers.leaguepedia.client import Row
from lol_ingest.providers.leaguepedia.countries import COUNTRY_CODES
from lol_ingest.providers.leaguepedia.fetch import Snapshot, page_title
from lol_ingest.registry import EditionSpec

PROVIDER: Provider = "leaguepedia"
ROLES: dict[str, Role] = {
    "Top": "top",
    "Jungle": "jungle",
    "Mid": "mid",
    "Bot": "bot",
    "Support": "support",
}
ROSTER_ROLES: dict[str, RosterRole] = {**ROLES, "Coach": "coach"}
SIDES: dict[str, Side] = {"1": "blue", "2": "red"}


@dataclass
class NormalizedEdition:
    data: EditionData
    refs: dict[str, str] = field(default_factory=dict)  # record key -> provider reference
    gaps: list[Gap] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)


def _ref(key: str, value: str) -> ExternalRef:
    return ExternalRef(provider=PROVIDER, key=key, value=value)


def _int(value: str) -> int | None:
    return int(value) if value.strip().lstrip("-").isdigit() else None


def _float(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def _date(value: str) -> date | None:
    return date.fromisoformat(value) if value else None


def _datetime(value: str) -> datetime | None:
    # Leaguepedia stores schedule and game times in UTC without an offset.
    return datetime.fromisoformat(value).replace(tzinfo=UTC) if value else None


def _duration(value: str) -> int | None:
    parts = value.split(":")
    if not value or not all(part.isdigit() for part in parts):
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds


def _split(value: str, sep: str) -> list[str]:
    return [item.strip() for item in value.split(sep) if item.strip()]


class _Normalizer:
    def __init__(self, snapshot: Snapshot, spec: EditionSpec, store: EntityStore) -> None:
        self.tables = snapshot.tables
        self.spec = spec
        self.store = store
        self.out = NormalizedEdition(data=None)  # type: ignore[arg-type]  # set in run()
        self.pages = {page.page: page for page in spec.leaguepedia.pages}
        # Cargo matches strings case-insensitively, and different tables link the same page
        # with different casing ('EasyLove' vs 'Easylove'), so lookups are case-folded.
        self.team_meta = {row["OverviewPage"].casefold(): row for row in self.tables["teams"]}
        self.roster_meta = {row["Team"].casefold(): row for row in self.tables["rosters"]}
        self.redirects = {
            row["AllName"].casefold(): row["OverviewPage"] for row in self.tables["playerRedirects"]
        }
        self.player_meta = {row["OverviewPage"].casefold(): row for row in self.tables["players"]}
        starts = [d for row in self.tables["tournaments"] if (d := _date(row["DateStart"]))]
        ends = [d for row in self.tables["tournaments"] if (d := _date(row["Date"]))]
        self.dates = DateRange(start=min(starts, default=None), end=max(ends, default=None))
        self._team_cache: dict[str, str | None] = {}
        self._player_cache: dict[str, str | None] = {}

    def issue(self, level: str, code: str, message: str) -> None:
        self.out.issues.append(Issue(level, code, message))  # type: ignore[arg-type]

    def gap(self, record: str, reason: str) -> None:
        self.out.gaps.append(Gap(record=record, reason=reason))

    # -- identity ---------------------------------------------------------------------------

    def team(self, name: str) -> str | None:
        page = page_title(name)
        page = self.team_meta.get(page.casefold(), {}).get("OverviewPage", page)
        if page.casefold() not in self._team_cache:
            found = self.store.find("teams", PROVIDER, "OverviewPage", page)
            self._team_cache[page.casefold()] = found or self._new_team(page)
        return self._team_cache[page.casefold()]

    def _new_team(self, page: str) -> str | None:
        meta = self.team_meta.get(page.casefold(), {})
        roster = self.roster_meta.get(page.casefold())
        if not roster or not roster["Region"]:
            self.issue("error", "team-region-unknown", f"no historical region for team {page!r}")
            return None
        try:
            region = self.store.region_for(PROVIDER, roster["Region"], self.dates.start)
        except IdentityError as error:
            self.issue("error", "region-unmapped", str(error))
            return None
        name = meta.get("Name") or strip_disambiguation(page)
        org_page = meta.get("OrganizationPage", "")
        org_id = None
        if org_page:
            org_id = self.store.find("organizations", PROVIDER, "OrganizationPage", org_page)
        if org_id is None:
            org = Organization(
                id=self.store.mint_id("org", name),
                name=name,
                external_refs=[_ref("OrganizationPage", org_page)] if org_page else [],
            )
            org_id = self.store.add("organizations", org).id
        team = TeamIdentity(
            id=self.store.mint_id("team", name),
            org=org_id,
            name=name,
            short_name=roster["Short"] or meta.get("Short") or None,
            region=region.id,
            active=DateRange(),
            external_refs=[_ref("OverviewPage", page)],
        )
        return self.store.add("teams", team).id

    def player(self, name: str) -> str | None:
        page = page_title(name)
        canonical = self.redirects.get(page.casefold(), page)
        canonical = self.player_meta.get(canonical.casefold(), {}).get("OverviewPage", canonical)
        if canonical.casefold() not in self._player_cache:
            found = self.store.find("players", PROVIDER, "OverviewPage", canonical)
            self._player_cache[canonical.casefold()] = found or self._new_player(canonical)
        return self._player_cache[canonical.casefold()]

    def _new_player(self, page: str) -> str | None:
        meta = self.player_meta.get(page.casefold(), {})
        handle = meta.get("ID") or strip_disambiguation(page)
        country_name = meta.get("Country", "")
        country = COUNTRY_CODES.get(country_name)
        if country_name and not country:
            self.issue("warning", "country-unmapped", f"{page}: unknown country {country_name!r}")
        try:
            # Disambiguated pages ('Bin (Chen Ze-Bin)') keep the qualifier in the ID so that
            # same-handle players never depend on import order for their IDs.
            player_id = self.store.mint_id("player", page if "(" in page else handle)
        except IdentityError as error:
            self.issue("error", "player-id", str(error))
            return None
        player = Player(
            id=player_id,
            handles=[PlayerHandle(handle=handle, active=DateRange())],
            real_name=meta.get("Name") or None,
            native_name=meta.get("NativeName") or None,
            country=country,
            external_refs=[_ref("OverviewPage", page)],
        )
        return self.store.add("players", player).id

    # -- records ----------------------------------------------------------------------------

    def run(self) -> NormalizedEdition:
        series = self.series()
        games = self.games(series)
        self.missing_games(series, games)
        stats = self.player_stats(games)
        rosters = self.rosters()
        placements = self.placements()
        edition = self.edition(list(series.values()))
        self.out.data = EditionData(
            edition=edition,
            series=sorted(series.values(), key=lambda s: s.id),
            games=sorted(games.values(), key=lambda g: g.id),
            player_stats=stats,
            rosters=rosters,
            placements=placements,
        )
        self.out.refs[record_key(edition)] = self.spec.leaguepedia.base_page
        return self.out

    def series(self) -> dict[str, Series]:
        """Series keyed by Leaguepedia MatchId."""
        by_match: dict[str, Series] = {}
        seen: set[str] = set()
        for row in self.tables["matches"]:
            match_id = row["MatchId"]
            if row["IsNullified"] == "1":
                self.issue("warning", "series-nullified", f"{match_id}: nullified, skipped")
                continue
            page = self.pages.get(row["OverviewPage"])
            stage = page.stage_for_tab(row["Tab"], _int(row["NMatchInTab"])) if page else None
            if stage is None:
                self.issue(
                    "error", "stage-unmapped", f"{match_id}: no stage for tab {row['Tab']!r}"
                )
                continue
            team1, team2 = self.team(row["Team1"]), self.team(row["Team2"])
            number = _int(row["NMatchInTab"])
            if team1 is None or team2 is None or number is None:
                self.gap(f"series:{match_id}", "teams or match number not known yet")
                continue
            series_id = f"ser:{self.spec.slug}-{stage}-{slugify(row['Tab'])}-{number:02d}"
            if series_id in seen:
                self.issue("error", "series-duplicate", f"{match_id}: duplicate ID {series_id}")
                continue
            seen.add(series_id)
            score1, score2 = _int(row["Team1Score"]), _int(row["Team2Score"])
            mvp = row["MVP"]
            series = Series(
                id=series_id,
                stage=stage,
                round=row["Tab"],
                number=number,
                best_of=_int(row["BestOf"]) or 1,
                teams=(team1, team2),
                score=(score1, score2) if score1 is not None and score2 is not None else None,
                winner={"1": team1, "2": team2}.get(row["Winner"]),
                forfeit=bool(row["FF"]),
                tiebreaker=row["IsTiebreaker"] == "1",
                start=_datetime(row["DateTimeUTC"]),
                patch=row["Patch"] or None,
                mvp=self.player(mvp) if mvp and mvp != "N/A" else None,
                external_refs=[_ref("MatchId", match_id)],
            )
            by_match[match_id] = series
            self.out.refs[record_key(series)] = match_id
        return by_match

    def games(self, series_by_match: dict[str, Series]) -> dict[str, Game]:
        """Games keyed by Leaguepedia GameId."""
        drafts = {row["GameId"]: row for row in self.tables["drafts"]}
        by_game: dict[str, Game] = {}
        assigned: dict[str, int] = defaultdict(int)
        for row in self.tables["games"]:
            game_ref = row["GameId"]
            series = series_by_match.get(row["MatchId"]) or self.series_for_unlinked_game(
                row, series_by_match.values(), assigned
            )
            number = _int(row["NGameInMatch"])
            if series is None or number is None:
                self.issue("error", "game-orphan", f"{game_ref}: no matching series")
                continue
            # Leaguepedia scoreboards list the blue side as Team1.
            blue, red = self.team(row["Team1"]), self.team(row["Team2"])
            winner = {"1": blue, "2": red}.get(row["Winner"])
            if blue is None or red is None or winner is None:
                self.issue("error", "game-teams", f"{game_ref}: teams or winner unknown")
                continue
            game_id = f"game:{series.id.removeprefix('ser:')}-g{number}"
            draft = self.draft(drafts.get(game_ref), blue, red)
            if draft is None:
                self.gap(f"game:{game_id}", "picks and bans not available")
            refs = [_ref("GameId", game_ref)]
            if row["RiotPlatformGameId"]:
                refs.append(_ref("RiotPlatformGameId", row["RiotPlatformGameId"]))
            game = Game(
                id=game_id,
                series=series.id,
                number=number,
                blue=blue,
                red=red,
                winner=winner,
                duration_seconds=_duration(row["Gamelength"]),
                patch=row["Patch"] or None,
                start=_datetime(row["DateTimeUTC"]),
                draft=draft,
                external_refs=refs,
            )
            by_game[game_ref] = game
            assigned[series.id] += 1
            self.out.refs[record_key(game)] = game_ref
        return by_game

    def series_for_unlinked_game(
        self, row: Row, series: Iterable[Series], assigned: dict[str, int]
    ) -> Series | None:
        """Some old scoreboards (Worlds 2011) use match IDs the schedule doesn't. Fall back to
        the series between the same teams on the same day that still has games unaccounted for."""
        teams = {self.team(row["Team1"]), self.team(row["Team2"])}
        played = _datetime(row["DateTimeUTC"])
        if played is None:
            return None
        candidates = [
            s
            for s in series
            if set(s.teams) == teams
            and s.score is not None
            and assigned[s.id] < sum(s.score)
            and s.start is not None
            and s.start.date() == played.date()
        ]
        if not candidates:
            return None
        # The same teams can meet twice in a day (an upper final, then the grand final), and old
        # schedule times are approximate: take the series scheduled closest to the game.
        match = min(candidates, key=lambda s: abs(((s.start or played) - played).total_seconds()))
        self.issue(
            "warning",
            "game-matched-by-teams",
            f"{row['GameId']}: no series with match ID {row['MatchId']!r}; matched to {match.id}",
        )
        return match

    def missing_games(self, series_by_match: dict[str, Series], games: dict[str, Game]) -> None:
        recorded: dict[str, int] = defaultdict(int)
        for game in games.values():
            recorded[game.series] += 1
        for series in series_by_match.values():
            expected = sum(series.score) if series.score and not series.forfeit else 0
            if recorded[series.id] < expected:
                self.gap(
                    f"series:{series.id}",
                    f"game records for {recorded[series.id]} of {expected} games",
                )

    def draft(self, row: Row | None, blue: str, red: str) -> Draft | None:
        if row is None:
            return None
        sides: dict[str, TeamDraft] = {}
        for n in (1, 2):
            team = self.team(row[f"Team{n}"])
            bans = [row[f"Team{n}Ban{i}"] for i in range(1, 6)]
            picks = [row[f"Team{n}Pick{i}"] for i in range(1, 6)]
            if team is None or not any(picks):
                return None
            sides[team] = TeamDraft(
                bans=[ban if ban and ban != "None" else None for ban in bans],
                picks=[pick for pick in picks if pick],
            )
        if set(sides) != {blue, red}:
            self.issue("warning", "draft-teams", f"draft teams {set(sides)} != game teams")
            return None
        return Draft(blue=sides[blue], red=sides[red])

    def player_stats(self, games_by_ref: dict[str, Game]) -> list[PlayerGameStats]:
        stats: list[PlayerGameStats] = []
        per_game: dict[str, int] = defaultdict(int)
        for row in self.tables["playerStats"]:
            game = games_by_ref.get(row["GameId"])
            team, player = self.team(row["Team"]), self.player(row["Link"])
            side, role = SIDES.get(row["Side"]), ROLES.get(row["Role"])
            if game is None or team is None or player is None or side is None or role is None:
                self.issue(
                    "warning", "stats-skipped", f"{row['GameId']}/{row['Link']}: unresolvable row"
                )
                continue
            kills, deaths, assists = (_int(row[k]) for k in ("Kills", "Deaths", "Assists"))
            if kills is None or deaths is None or assists is None:
                self.issue("warning", "stats-kda", f"{row['GameId']}/{row['Link']}: missing KDA")
                continue
            stats.append(
                PlayerGameStats(
                    game=game.id,
                    team=team,
                    player=player,
                    side=side,
                    role=role,
                    champion=row["Champion"],
                    kills=kills,
                    deaths=deaths,
                    assists=assists,
                    gold=_int(row["Gold"]),
                    cs=_int(row["CS"]),
                    damage_to_champions=_int(row["DamageToChampions"]),
                    vision_score=_int(row["VisionScore"]),
                    summoner_spells=_split(row["SummonerSpells"], ","),
                    items=_split(row["Items"], ";"),
                    trinket=row["Trinket"] or None,
                    keystone=row["KeystoneRune"] or row["KeystoneMastery"] or None,
                    primary_tree=row["PrimaryTree"] or None,
                    secondary_tree=row["SecondaryTree"] or None,
                    runes=_split(row["Runes"], ","),
                )
            )
            self.out.refs[record_key(stats[-1])] = f"{row['GameId']}/{row['Link']}"
            per_game[game.id] += 1
        for game in games_by_ref.values():
            if per_game[game.id] != 10:
                self.gap(f"game:{game.id}", f"player stats for {per_game[game.id]} of 10 players")
        return sorted(stats, key=record_key)

    def rosters(self) -> list[RosterEntry]:
        entries: dict[str, RosterEntry] = {}
        for row in self.tables["rosterPlayers"]:
            team, player = self.team(row["Team"]), self.player(row["Link"])
            # Flex players are registered under several roles ("Top,Mid"): one entry per role.
            for raw_role in row["Role"].split(","):
                raw_role = raw_role.strip()
                # Staff titles vary ("Head Coach", "Strategic Coach"); all are coaches here.
                role = ROSTER_ROLES.get(raw_role) or (
                    "coach" if "coach" in raw_role.lower() else None
                )
                if role is None:
                    where = f"{row['Team']}/{row['Link']}"
                    self.issue("warning", "roster-role", f"{where}: role {raw_role!r}")
                    continue
                if team is None or player is None:
                    continue
                entry = RosterEntry(team=team, player=player, role=role)
                key = record_key(entry)
                entries[key] = entry
                self.out.refs[key] = f"{row['OverviewPage']}/{row['Team']}/{row['Link']}"
        return [entries[key] for key in sorted(entries)]

    def placements(self) -> list[Placement]:
        placements: list[Placement] = []
        for row in self.tables["results"]:
            if row["Showmatch"] == "1":
                continue
            team = self.team(row["Team"])
            places = [n for part in row["Place"].split("-") if (n := _int(part)) is not None]
            if team is None or not places:
                self.issue("warning", "placement", f"{row['Team']}: place {row['Place']!r}")
                continue
            placement = Placement(
                team=team,
                place_from=places[0],
                place_to=places[-1],
                prize_usd=_float(row["PrizeUSD"]),
            )
            placements.append(placement)
            self.out.refs[record_key(placement)] = f"{row['OverviewPage']}/{row['Team']}"
        return sorted(placements, key=record_key)

    def edition(self, series: list[Series]) -> Edition:
        first_stage: dict[str, tuple[datetime, str]] = {}
        for s in series:
            when = s.start or datetime.max.replace(tzinfo=UTC)
            for team_id in s.teams:
                if team_id not in first_stage or when < first_stage[team_id][0]:
                    first_stage[team_id] = (when, s.stage)
        participants: dict[str, Participant] = {}
        for row in self.tables["rosters"]:
            team = self.team(row["Team"])
            if team is None or team in participants:
                continue
            page = self.pages[row["OverviewPage"]]
            fallback = page.stage or next(iter(page.tabs.values()))
            try:
                region = self.store.region_for(PROVIDER, row["Region"], self.dates.start)
            except IdentityError as error:
                self.issue("error", "region-unmapped", str(error))
                continue
            participants[team] = Participant(
                team=team,
                region=region.id,
                entry_stage=first_stage.get(team, (None, fallback))[1],
            )
        return Edition(
            id=f"ed:{self.spec.slug}",
            tournament=f"tour:{self.spec.tournament}",
            year=self.spec.year,
            name=self.spec.name,
            status=self.spec.status,
            dates=self.dates,
            stages=self.spec.stages,
            participants=[participants[key] for key in sorted(participants)],
            external_refs=[_ref("OverviewPage", self.spec.leaguepedia.base_page)],
        )


def normalize(snapshot: Snapshot, spec: EditionSpec, store: EntityStore) -> NormalizedEdition:
    return _Normalizer(snapshot, spec, store).run()
