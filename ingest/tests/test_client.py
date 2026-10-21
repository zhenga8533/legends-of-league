import urllib.parse
from pathlib import Path
from typing import Any

import pytest

from lol_ingest.providers.leaguepedia.client import (
    PAGE_SIZE,
    CargoClient,
    LeaguepediaError,
    parse_field,
)


class FakeWiki:
    """Answers MediaWiki login and cargoquery requests from an in-memory table."""

    def __init__(self, rows: list[dict[str, str]], *, rate_limited: int = 0) -> None:
        self.rows = rows
        self.rate_limited = rate_limited
        self.calls: list[dict[str, str]] = []
        self.login_result = "Success"

    def __call__(self, url: str, body: bytes | None) -> dict[str, Any]:
        query = body.decode() if body else url.split("?", 1)[1]
        params = dict(urllib.parse.parse_qsl(query))
        self.calls.append(params)
        if params.get("meta") == "tokens":
            return {"query": {"tokens": {"logintoken": "token+\\"}}}
        if params["action"] == "login":
            return {"login": {"result": self.login_result, "reason": "bad password"}}
        if self.rate_limited:
            self.rate_limited -= 1
            return {"error": {"code": "ratelimited"}}
        offset, limit = int(params["offset"]), int(params["limit"])
        return {"cargoquery": [{"title": row} for row in self.rows[offset : offset + limit]]}


def client(wiki: FakeWiki, sleeps: list[float], **kwargs: Any) -> CargoClient:
    return CargoClient("bot@app", "secret", transport=wiki, sleep=sleeps.append, **kwargs)


def test_fields_are_aliased_without_underscores() -> None:
    assert parse_field("DateTime_UTC") == ("DateTime_UTC", "DateTimeUTC")
    assert parse_field("N_GameInMatch=GameN") == ("N_GameInMatch", "GameN")


def test_logs_in_once_then_follows_pagination() -> None:
    wiki = FakeWiki([{"GameId": str(n)} for n in range(PAGE_SIZE + 3)])

    rows = client(wiki, []).query("ScoreboardGames", ["GameId", "Missing"])

    assert len(rows) == PAGE_SIZE + 3
    assert rows[0] == {"GameId": "0", "Missing": ""}
    actions = [call["action"] for call in wiki.calls]
    assert actions == ["query", "login", "cargoquery", "cargoquery"]
    assert [call.get("offset") for call in wiki.calls[2:]] == ["0", str(PAGE_SIZE)]


def test_retries_rate_limits_with_backoff() -> None:
    wiki = FakeWiki([{"GameId": "1"}], rate_limited=2)
    sleeps: list[float] = []

    rows = client(wiki, sleeps, min_interval=0).query("ScoreboardGames", ["GameId"])

    assert rows == [{"GameId": "1"}]
    assert sleeps == [2, 4]


def test_gives_up_after_max_retries() -> None:
    wiki = FakeWiki([], rate_limited=10)

    with pytest.raises(LeaguepediaError, match="rate limit"):
        client(wiki, [], min_interval=0, max_retries=2).query("ScoreboardGames", ["GameId"])


def test_cache_answers_repeat_queries(tmp_path: Path) -> None:
    wiki = FakeWiki([{"GameId": "1"}])
    first = client(wiki, [], cache_dir=tmp_path).query("ScoreboardGames", ["GameId"])
    calls = len(wiki.calls)

    second = client(wiki, [], cache_dir=tmp_path).query("ScoreboardGames", ["GameId"])

    assert first == second and len(wiki.calls) == calls


def test_requires_credentials() -> None:
    with pytest.raises(LeaguepediaError, match="LEAGUEPEDIA_BOT_USER"):
        CargoClient("", "", transport=FakeWiki([]))


def test_reports_login_failure() -> None:
    wiki = FakeWiki([])
    wiki.login_result = "Failed"

    with pytest.raises(LeaguepediaError, match="bad password"):
        client(wiki, []).query("Teams", ["Name"])
