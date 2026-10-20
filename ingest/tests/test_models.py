from datetime import date

import pytest
from pydantic import ValidationError

from lol_ingest.models import DateRange, Player, TeamIdentity


def test_team_identity_round_trips_with_camel_case_aliases() -> None:
    team = TeamIdentity.model_validate(
        {
            "id": "team:skt-t1",
            "org": "org:t1",
            "name": "SK Telecom T1",
            "shortName": "SKT",
            "region": "region:lck",
            "active": {"start": "2013-02-01", "end": "2019-10-23"},
        }
    )

    dumped = team.model_dump(mode="json", by_alias=True, exclude_defaults=True)

    assert dumped["shortName"] == "SKT"
    assert TeamIdentity.model_validate(dumped) == team


@pytest.mark.parametrize("bad_id", ["T1", "team:T1", "org:t1", "team:skt--t1", "team:skt t1"])
def test_ids_must_be_prefixed_lowercase_slugs(bad_id: str) -> None:
    with pytest.raises(ValidationError):
        TeamIdentity(
            id=bad_id,
            org="org:t1",
            name="T1",
            short_name="T1",
            region="region:lck",
            active=DateRange(),
        )


def test_date_range_rejects_end_before_start() -> None:
    with pytest.raises(ValidationError, match="before start"):
        DateRange(start=date(2020, 1, 2), end=date(2020, 1, 1))


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        Player.model_validate(
            {"id": "player:faker", "handles": [{"handle": "Faker", "active": {}}], "team": "T1"}
        )


def test_player_requires_at_least_one_handle() -> None:
    with pytest.raises(ValidationError):
        Player(id="player:faker", handles=[])
