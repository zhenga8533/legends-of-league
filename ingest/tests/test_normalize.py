from lol_ingest.identity import EntityStore
from lol_ingest.providers.leaguepedia.fetch import Snapshot
from lol_ingest.providers.leaguepedia.normalize import normalize
from lol_ingest.registry import EditionSpec

FINAL = "ser:worlds-2024-knockout-finals-01"


def test_series_get_stable_ids_and_results(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    result = normalize(snapshot, spec, store)

    assert [issue for issue in result.issues if issue.level == "error"] == []
    series = {s.id: s for s in result.data.series}
    assert set(series) == {
        "ser:worlds-2024-play-in-round-1-01",
        "ser:worlds-2024-swiss-round-1-01",
        FINAL,
    }
    final = series[FINAL]
    assert final.teams == ("team:bilibili-gaming", "team:t1")
    assert final.score == (2, 3)
    assert final.winner == "team:t1"
    assert final.best_of == 5
    assert final.mvp == "player:faker"
    assert result.refs[f"series:{FINAL}"] == "2024 Season World Championship/Main Event_Finals_1"


def test_games_carry_sides_drafts_and_duration(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    result = normalize(snapshot, spec, store)

    games = [g for g in result.data.games if g.series == FINAL]
    assert [g.number for g in sorted(games, key=lambda g: g.number)] == [1, 2, 3, 4, 5]
    assert len(result.data.games) == 8
    for game in result.data.games:
        assert game.draft is not None
        assert len(game.draft.blue.picks) == len(game.draft.red.picks) == 5
        assert len(game.draft.blue.bans) == 5
        assert game.duration_seconds and game.duration_seconds > 15 * 60


def test_every_game_has_ten_player_stat_rows_on_the_right_side(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    result = normalize(snapshot, spec, store)

    games = {g.id: g for g in result.data.games}
    assert len(result.data.player_stats) == 80
    assert result.gaps == []
    for stats in result.data.player_stats:
        game = games[stats.game]
        assert stats.team == (game.blue if stats.side == "blue" else game.red)


def test_new_entities_use_historical_region_and_no_invented_values(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    normalize(snapshot, spec, store)

    vikings = store.teams["team:vikings-esports"]
    assert vikings.region == "region:vcs"
    assert vikings.name == "Vikings Esports"
    assert vikings.short_name is None  # Leaguepedia has no tag for this team
    assert store.teams["team:t1"].org == "org:t1"
    assert "player:bin-chen-ze-bin" in store.players  # disambiguated page keeps its qualifier
    assert store.players["player:faker"].country == "KR"


def test_entry_stage_is_the_first_stage_a_team_played(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    result = normalize(snapshot, spec, store)

    entry = {p.team: p.entry_stage for p in result.data.edition.participants}
    assert entry["team:mad-lions-koi"] == "play-in"
    assert entry["team:bilibili-gaming"] == "swiss"


def test_links_differing_only_in_case_resolve_to_one_player(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    row = next(r for r in snapshot.tables["playerStats"] if r["Link"] == "Faker")
    row["Link"] = "FAKER"

    normalize(snapshot, spec, store)

    assert [p for p in store.players if p.startswith("player:faker")] == ["player:faker"]


def test_existing_entities_are_reused(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    normalize(snapshot, spec, store)
    added = set(store.added)
    store.added.clear()

    normalize(snapshot, spec, store)

    assert added and store.added == set()


def test_unmapped_region_code_is_an_error(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    for row in snapshot.tables["rosters"]:
        row["Region"] = "ZZ"

    result = normalize(snapshot, spec, store)

    assert any(issue.code == "region-unmapped" for issue in result.issues)


def test_series_without_game_records_are_recorded_as_gaps(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    final_games = [g for g in snapshot.tables["games"] if "Finals" in g["MatchId"]]
    snapshot.tables["games"] = [g for g in snapshot.tables["games"] if g not in final_games]

    result = normalize(snapshot, spec, store)

    assert [(g.record, g.reason) for g in result.gaps] == [
        (f"series:{FINAL}", "game records for 0 of 5 games")
    ]


def test_coach_titles_are_normalized(
    snapshot: Snapshot, spec: EditionSpec, store: EntityStore
) -> None:
    coach = next(r for r in snapshot.tables["rosterPlayers"] if r["Role"] == "Coach")
    coach["Role"] = "Head Coach"

    result = normalize(snapshot, spec, store)

    assert not [i for i in result.issues if i.code == "roster-role"]
    assert any(entry.role == "coach" for entry in result.data.rosters)
