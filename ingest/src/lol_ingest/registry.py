"""The edition registry: which editions exist and where each provider keeps their data."""

from fnmatch import fnmatchcase
from pathlib import Path
from typing import Literal, Self

import yaml
from pydantic import Field, model_validator

from lol_ingest.models.common import CanonicalModel, StageId
from lol_ingest.models.edition import EditionStatus, Stage

TournamentSlug = Literal["worlds", "msi", "first-stand"]


class LeaguepediaPage(CanonicalModel):
    """One Leaguepedia tournament page and how its schedule tabs map onto our stages."""

    page: str
    stage: StageId | None = Field(default=None, description="Stage for every tab on the page.")
    tabs: dict[str, StageId] = Field(
        default={},
        description=(
            "Tab-name glob -> stage. The first matching glob wins. A glob containing '#' is "
            "matched against 'Tab#N' (N = match number in the tab), for tabs mixing two stages."
        ),
    )

    @model_validator(mode="after")
    def _one_mapping(self) -> Self:
        if (self.stage is None) == (not self.tabs):
            raise ValueError(f"{self.page}: set exactly one of 'stage' or 'tabs'")
        return self

    def stage_for_tab(self, tab: str, number: int | None = None) -> StageId | None:
        if self.stage is not None:
            return self.stage
        numbered = f"{tab}#{number}"
        return next(
            (
                stage
                for glob, stage in self.tabs.items()
                if fnmatchcase(numbered if "#" in glob else tab, glob)
            ),
            None,
        )


class LeaguepediaSource(CanonicalModel):
    base_page: str = Field(description="Page holding the edition-wide results table.")
    pages: list[LeaguepediaPage] = Field(min_length=1)


class EditionSpec(CanonicalModel):
    tournament: TournamentSlug
    year: int
    name: str
    status: EditionStatus
    stages: list[Stage] = Field(min_length=1)
    leaguepedia: LeaguepediaSource

    @model_validator(mode="after")
    def _known_stages(self) -> Self:
        known = {stage.id for stage in self.stages}
        for page in self.leaguepedia.pages:
            used = {page.stage} if page.stage else set(page.tabs.values())
            if unknown := used - known:
                raise ValueError(f"{self.slug}: {page.page} maps to unknown stages {unknown}")
        return self

    @property
    def slug(self) -> str:
        return f"{self.tournament}-{self.year}"


class Registry(CanonicalModel):
    editions: list[EditionSpec]

    @model_validator(mode="after")
    def _unique(self) -> Self:
        slugs = [edition.slug for edition in self.editions]
        if duplicates := {slug for slug in slugs if slugs.count(slug) > 1}:
            raise ValueError(f"duplicate editions: {sorted(duplicates)}")
        return self

    def select(self, tournament: str, year: str) -> list[EditionSpec]:
        return [
            edition
            for edition in self.editions
            if tournament in ("all", edition.tournament) and year in ("all", str(edition.year))
        ]


def load_registry(data_dir: Path) -> Registry:
    raw = yaml.safe_load((data_dir / "editions.yaml").read_text(encoding="utf-8"))
    return Registry.model_validate(raw)
