from datetime import date
from pathlib import Path

import pytest

from lol_ingest.identity import EntityStore, IdentityError


def test_region_codes_match_case_insensitively_and_by_date(data_dir: Path) -> None:
    store = EntityStore.load(data_dir)

    assert store.region_for("leaguepedia", "kr", date(2024, 5, 1)).id == "region:lck"
    assert store.region_for("leaguepedia", "APAC", date(2024, 10, 1)).id == "region:pcs"
    assert store.region_for("leaguepedia", "apac", date(2025, 3, 1)).id == "region:lcp"


def test_unknown_region_code_is_an_error(data_dir: Path) -> None:
    store = EntityStore.load(data_dir)

    with pytest.raises(IdentityError, match="exactly one region"):
        store.region_for("leaguepedia", "XX", date(2024, 1, 1))
