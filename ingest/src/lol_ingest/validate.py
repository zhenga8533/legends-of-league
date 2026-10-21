"""Integrity checks over an edition's records. Errors block an import; warnings are reported."""

from collections import Counter, defaultdict
from datetime import timedelta

from lol_ingest.edition_data import EditionData, Issue
from lol_ingest.identity import EntityStore

# Schedules are stored in UTC, so a match can fall a day outside the local event dates.
DATE_TOLERANCE = timedelta(days=1)


def validate_edition(data: EditionData, store: EntityStore) -> list[Issue]:
    issues: list[Issue] = []

    def error(code: str, message: str) -> None:
        issues.append(Issue("error", code, message))

    def warning(code: str, message: str) -> None:
        issues.append(Issue("warning", code, message))

    edition = data.edition
    known = store.all_ids()

    def check_ref(entity_id: str | None, where: str) -> None:
        if entity_id is not None and entity_id not in known:
            error("unknown-entity", f"{where}: {entity_id} is not in data/entities")

    stages = {stage.id for stage in edition.stages}
    participants = {participant.team for participant in edition.participants}
    for participant in edition.participants:
        check_ref(participant.team, edition.id)
        check_ref(participant.region, edition.id)
    if len(participants) != len(edition.participants):
        error("participant-duplicate", f"{edition.id}: a team is listed twice")

    series_by_id = {series.id: series for series in data.series}
    for series in data.series:
        for team in series.teams:
            check_ref(team, series.id)
            if team not in participants:
                error("series-team", f"{series.id}: {team} is not a participant")
        check_ref(series.mvp, series.id)
        if series.stage not in stages:
            error("series-stage", f"{series.id}: unknown stage {series.stage}")
        if edition.status == "completed" and (series.score is None or series.winner is None):
            error("series-incomplete", f"{series.id}: completed edition but no result")
        if series.score and series.winner:
            winner_score = series.score[series.teams.index(series.winner)]
            if winner_score != max(series.score) or series.score[0] == series.score[1]:
                error("series-winner", f"{series.id}: winner does not match score {series.score}")
            if not series.forfeit and winner_score != series.best_of // 2 + 1:
                error("series-score", f"{series.id}: Bo{series.best_of} won {series.score}")
        start, end = edition.dates.start, edition.dates.end
        if series.start and start and end:
            day = series.start.date()
            if not start - DATE_TOLERANCE <= day <= end + DATE_TOLERANCE:
                warning("series-date", f"{series.id}: {day} is outside {start}..{end}")

    games_by_series: dict[str, list[str]] = defaultdict(list)
    game_teams: dict[str, tuple[str, str]] = {}
    for game in data.games:
        parent = series_by_id.get(game.series)
        if parent is None:
            error("game-series", f"{game.id}: unknown series {game.series}")
            continue
        if {game.blue, game.red} != set(parent.teams):
            error("game-teams", f"{game.id}: teams differ from series {parent.id}")
        games_by_series[parent.id].append(game.winner)
        game_teams[game.id] = (game.blue, game.red)
    game_numbers = Counter((game.series, game.number) for game in data.games)
    for (series_id, number), count in game_numbers.items():
        if count > 1:
            error("game-duplicate", f"{series_id}: game {number} appears {count} times")

    for series in data.series:
        winners = games_by_series.get(series.id, [])
        if not series.score or series.forfeit:
            continue
        wins = tuple(winners.count(team) for team in series.teams)
        if not winners:
            warning("games-missing", f"{series.id}: no game records")
        elif any(won > scored for won, scored in zip(wins, series.score, strict=True)):
            error(
                "games-score", f"{series.id}: game winners {wins} exceed the score {series.score}"
            )
        elif len(winners) == sum(series.score) and wins != series.score:
            error("games-score", f"{series.id}: game winners do not add up to {series.score}")
        elif len(winners) < sum(series.score):
            warning(
                "games-partial",
                f"{series.id}: {len(winners)} of {sum(series.score)} games recorded",
            )

    per_team: Counter[tuple[str, str]] = Counter()
    for stats in data.player_stats:
        check_ref(stats.player, stats.game)
        teams = game_teams.get(stats.game)
        if teams is None:
            error("stats-game", f"{stats.game}/{stats.player}: unknown game")
            continue
        if stats.team not in teams:
            error("stats-team", f"{stats.game}/{stats.player}: {stats.team} did not play")
        elif (stats.side == "blue") != (stats.team == teams[0]):
            error("stats-side", f"{stats.game}/{stats.player}: side disagrees with the game")
        per_team[(stats.game, stats.team)] += 1
    for (game_id, team), count in per_team.items():
        if count > 5:
            error("stats-count", f"{game_id}: {count} stat rows for {team}")

    for entry in data.rosters:
        check_ref(entry.player, f"roster {entry.team}")
        if entry.team not in participants:
            error("roster-team", f"roster: {entry.team} is not a participant")

    placed = Counter(placement.team for placement in data.placements)
    for team, count in placed.items():
        if count > 1:
            error("placement-duplicate", f"{team} is placed {count} times")
        if team not in participants:
            error("placement-team", f"placement: {team} is not a participant")
    if edition.status == "completed":
        for team in sorted(participants - set(placed)):
            warning("placement-missing", f"{team} has no final placement")

    return issues
