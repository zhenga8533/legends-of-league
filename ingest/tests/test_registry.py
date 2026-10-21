import pytest
from pydantic import ValidationError

from lol_ingest.registry import EditionSpec, LeaguepediaPage, Registry


def spec(**overrides: object) -> dict[str, object]:
    return {
        "tournament": "worlds",
        "year": 2024,
        "name": "2024 World Championship",
        "status": "completed",
        "stages": [{"id": "swiss", "name": "Swiss"}, {"id": "knockout", "name": "Knockout"}],
        "leaguepedia": {
            "basePage": "2024 Season World Championship",
            "pages": [{"page": "Main Event", "tabs": {"Round *": "swiss", "*": "knockout"}}],
        },
        **overrides,
    }


def test_first_matching_tab_glob_wins() -> None:
    page = LeaguepediaPage(page="Main Event", tabs={"Round *": "swiss", "*": "knockout"})

    assert page.stage_for_tab("Round 3") == "swiss"
    assert page.stage_for_tab("Finals") == "knockout"


def test_page_needs_exactly_one_mapping() -> None:
    with pytest.raises(ValidationError, match="exactly one"):
        LeaguepediaPage(page="Main Event")
    with pytest.raises(ValidationError, match="exactly one"):
        LeaguepediaPage(page="Main Event", stage="swiss", tabs={"*": "swiss"})


def test_pages_must_map_to_declared_stages() -> None:
    bad = spec(stages=[{"id": "swiss", "name": "Swiss"}])

    with pytest.raises(ValidationError, match="unknown stages"):
        EditionSpec.model_validate(bad)


def test_select_filters_by_tournament_and_year() -> None:
    registry = Registry.model_validate(
        {"editions": [spec(), spec(year=2023, name="2023 World Championship")]}
    )

    assert [e.slug for e in registry.select("worlds", "all")] == ["worlds-2024", "worlds-2023"]
    assert [e.slug for e in registry.select("all", "2023")] == ["worlds-2023"]
    assert registry.select("msi", "all") == []


def test_duplicate_editions_are_rejected() -> None:
    with pytest.raises(ValidationError, match="duplicate"):
        Registry.model_validate({"editions": [spec(), spec()]})
