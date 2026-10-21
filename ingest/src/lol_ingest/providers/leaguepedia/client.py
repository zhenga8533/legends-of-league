"""Minimal Leaguepedia (MediaWiki Cargo) API client.

Fandom rate-limits anonymous Cargo queries so heavily that they are unusable, so the client
always logs in with a bot password (Special:BotPasswords, with Cargo rights).
"""

import hashlib
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

API_URL = "https://lol.fandom.com/api.php"
USER_AGENT = "legends-of-league-ingest/0.1 (+https://github.com/zhenga8533/legends-of-league)"
PAGE_SIZE = 500  # Cargo's maximum rows per request

Row = dict[str, str]
# (url, urlencoded POST body or None for GET) -> decoded JSON response
Transport = Callable[[str, bytes | None], dict[str, Any]]


class LeaguepediaError(RuntimeError):
    pass


class _RetryableError(LeaguepediaError):
    pass


def urllib_transport() -> Transport:
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    opener.addheaders = [("User-Agent", USER_AGENT)]

    def send(url: str, body: bytes | None) -> dict[str, Any]:
        try:
            with opener.open(url, data=body, timeout=60) as response:
                result: dict[str, Any] = json.load(response)
                return result
        except urllib.error.HTTPError as error:
            if error.code == 429 or error.code >= 500:
                raise _RetryableError(f"HTTP {error.code} from {url}") from error
            raise LeaguepediaError(f"HTTP {error.code} from {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise _RetryableError(f"network error: {error}") from error

    return send


def parse_field(field: str) -> tuple[str, str]:
    """'Field=Alias' -> (expression, alias). Without an alias, underscores are dropped, because
    Cargo reports 'DateTime_UTC' as 'DateTime UTC' in results."""
    if "=" in field:
        expression, alias = field.split("=", 1)
        return expression, alias
    return field, field.replace("_", "")


class CargoClient:
    def __init__(
        self,
        username: str,
        password: str,
        *,
        transport: Transport | None = None,
        cache_dir: Path | None = None,
        min_interval: float = 0.5,
        max_retries: int = 5,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not username or not password:
            raise LeaguepediaError(
                "Leaguepedia credentials are required: set LEAGUEPEDIA_BOT_USER and "
                "LEAGUEPEDIA_BOT_PASSWORD (a bot password from Special:BotPasswords)."
            )
        self._username = username
        self._password = password
        self._transport = transport or urllib_transport()
        self._cache_dir = cache_dir
        self._min_interval = min_interval
        self._max_retries = max_retries
        self._sleep = sleep
        self._clock = clock
        self._last_request: float | None = None
        self._logged_in = False
        self.requests_made = 0

    def query(
        self,
        tables: str,
        fields: Sequence[str],
        *,
        where: str = "",
        order_by: str = "",
        join_on: str = "",
        use_cache: bool = True,
    ) -> list[Row]:
        """Run a Cargo query, following pagination, and return rows keyed by field alias."""
        columns = [parse_field(field) for field in fields]
        params = {
            "action": "cargoquery",
            "tables": tables,
            "fields": ",".join(f"{expression}={alias}" for expression, alias in columns),
            "where": where,
            "order_by": order_by,
            "join_on": join_on,
            "limit": str(PAGE_SIZE),
        }
        cache_file = self._cache_file(params)
        if use_cache and cache_file and cache_file.exists():
            cached: list[Row] = json.loads(cache_file.read_text(encoding="utf-8"))
            return cached

        rows: list[Row] = []
        while True:
            response = self._call({**params, "offset": str(len(rows))})
            page = [item["title"] for item in response.get("cargoquery", [])]
            rows.extend(
                {alias: (page_row.get(alias) or "") for _, alias in columns} for page_row in page
            )
            if len(page) < PAGE_SIZE:
                break

        if cache_file:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return rows

    def _cache_file(self, params: dict[str, str]) -> Path | None:
        if self._cache_dir is None:
            return None
        digest = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:32]
        return self._cache_dir / f"{digest}.json"

    def _login(self) -> None:
        tokens = self._request({"action": "query", "meta": "tokens", "type": "login"})
        token = tokens["query"]["tokens"]["logintoken"]
        result = self._request(
            {
                "action": "login",
                "lgname": self._username,
                "lgpassword": self._password,
                "lgtoken": token,
            },
            post=True,
        )["login"]
        if result.get("result") != "Success":
            raise LeaguepediaError(f"Leaguepedia login failed: {result.get('reason', result)}")
        self._logged_in = True

    def _call(self, params: dict[str, str]) -> dict[str, Any]:
        if not self._logged_in:
            self._login()
        return self._request(params)

    def _request(self, params: dict[str, str], *, post: bool = False) -> dict[str, Any]:
        body = urllib.parse.urlencode({**params, "format": "json"})
        for attempt in range(self._max_retries + 1):
            self._throttle()
            try:
                self.requests_made += 1
                if post:
                    response = self._transport(API_URL, body.encode())
                else:
                    response = self._transport(f"{API_URL}?{body}", None)
                error = response.get("error")
                if error and error.get("code") == "ratelimited":
                    raise _RetryableError("Leaguepedia rate limit reached")
                if error:
                    raise LeaguepediaError(f"Leaguepedia API error {error.get('code')}: {error}")
                return response
            except _RetryableError:
                if attempt == self._max_retries:
                    raise
                self._sleep(min(2 ** (attempt + 1), 60))
        raise AssertionError("unreachable")

    def _throttle(self) -> None:
        now = self._clock()
        if self._last_request is not None:
            wait = self._min_interval - (now - self._last_request)
            if wait > 0:
                self._sleep(wait)
                now += wait
        self._last_request = now
