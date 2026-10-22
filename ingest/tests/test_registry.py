from pathlib import Path

import pytest
from pydantic import ValidationError

from lol_ingest.registry import (
    EditionSpec,
    LeaguepediaPage,
    Registry,
    load_registry,
    set_status,
)


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


def test_numbered_tab_globs_pick_out_single_matches() -> None:
    page = LeaguepediaPage(
        page="Play-In", tabs={"Knockout Stage#3": "round-3", "Knockout Stage": "round-2"}
    )

    assert page.stage_for_tab("Knockout Stage", 3) == "round-3"
    assert page.stage_for_tab("Knockout Stage", 1) == "round-2"


def test_set_status_changes_only_that_line(data_dir: Path) -> None:
    registry = data_dir / "editions.yaml"
    before = registry.read_text(encoding="utf-8").splitlines()

    set_status(data_dir, "worlds", 2023, "live")

    after = registry.read_text(encoding="utf-8").splitlines()
    assert [(a, b) for a, b in zip(before, after, strict=True) if a != b] == [
        ("    status: completed", "    status: live")
    ]
    assert load_registry(data_dir).select("worlds", "2023")[0].status == "live"
    with pytest.raises(ValueError, match="worlds-1999"):
        set_status(data_dir, "worlds", 1999, "live")
