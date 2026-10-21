import pytest

from lol_ingest.edition_data import EditionData
from lol_ingest.identity import EntityStore
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.providers.leaguepedia.normalize import normalize
from lol_ingest.registry import EditionSpec
from lol_ingest.validate import validate_edition


@pytest.fixture
def data(snapshot: Snapshot, spec: EditionSpec, store: EntityStore) -> EditionData:
    return normalize(snapshot, spec, store).data


def codes(data: EditionData, store: EntityStore) -> set[str]:
    return {issue.code for issue in validate_edition(data, store) if issue.level == "error"}


def test_real_data_is_valid(data: EditionData, store: EntityStore) -> None:
    assert codes(data, store) == set()


def test_series_score_must_match_game_winners(data: EditionData, store: EntityStore) -> None:
    final = next(s for s in data.series if s.id.endswith("finals-01"))
    data.series[data.series.index(final)] = final.model_copy(update={"score": (3, 2)})

    assert {"series-winner", "games-score"} <= codes(data, store)


def test_player_side_must_match_the_game(data: EditionData, store: EntityStore) -> None:
    row = data.player_stats[0]
    flipped = "red" if row.side == "blue" else "blue"
    data.player_stats[0] = row.model_copy(update={"side": flipped})

    assert "stats-side" in codes(data, store)


def test_references_must_exist(data: EditionData, store: EntityStore) -> None:
    data.rosters[0] = data.rosters[0].model_copy(update={"player": "player:nobody"})

    assert "unknown-entity" in codes(data, store)


def test_completed_edition_needs_results(data: EditionData, store: EntityStore) -> None:
    data.series[0] = data.series[0].model_copy(update={"winner": None, "score": None})

    assert "series-incomplete" in codes(data, store)


def test_partial_game_records_are_not_contradictions(data: EditionData, store: EntityStore) -> None:
    final_games = [g for g in data.games if g.series.endswith("finals-01")]
    data.games.remove(final_games[0])

    issues = validate_edition(data, store)

    assert "games-score" not in {i.code for i in issues}
    assert "games-partial" in {i.code for i in issues}
