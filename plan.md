# Legends of League — Project Planning & Architecture

I want to create a new project called **Legends of League**, with the GitHub repository named `legends-of-league`.

The goal is to build a comprehensive, modern, and extensible platform for exploring the history of League of Legends international esports tournaments and simulating tournament outcomes.

The platform should initially focus on:
- World Championship (Worlds)
- Mid-Season Invitational (MSI)
- First Stand Tournament

However, the architecture should support additional international tournaments in the future, including historical or discontinued events.

**IMPORTANT: You are currently operating in Plan Mode. Do not begin implementation until we have thoroughly discussed the requirements, researched the available data sources, evaluated architectural options, and agreed on an implementation plan.**

You are encouraged to ask as many questions as necessary. Do not make significant assumptions about functionality, architecture, technology choices, data sources, or user experience without discussing them with me first.

## 1. Primary Objectives

The platform should support two major areas:

### A. Historical Tournament Archive

Build a comprehensive, searchable, and interactive archive of all historical international League of Legends tournaments.

Ideally, users should be able to explore:

- Every historical edition of Worlds, MSI, and First Stand, from each tournament's inaugural year onward.
- Tournament dates, locations, formats, rules, and participating teams.
- Tournament stages, groups, standings, brackets, and advancement paths.
- Complete match and series results, including individual game scores.
- Historical team rosters, players, regions, and seeds.
- Tournament winners, runners-up, final placements, and championship history.
- Match statistics, champion picks/bans, and player performance where reliable data is available.
- Historical changes to tournament formats, regional allocations, and qualification systems.
- Head-to-head records between teams and regions.
- Tournament records, milestones, and notable achievements.

Historical information must remain accurate to the relevant tournament year. For example, team rosters, regional affiliations, tournament formats, and qualification rules should reflect the historical event rather than current information.

Avoid fabricating missing historical data. Missing, incomplete, and unverified records should be explicitly identifiable.

### B. Tournament Simulation Engine

Develop a flexible simulation engine capable of recreating historical tournaments and generating hypothetical tournament outcomes.

Potential capabilities include:

- Simulating any supported historical tournament using its actual participants and format.
- Replaying historical tournaments with alternative outcomes.
- Simulating upcoming international tournaments.
- Creating custom tournaments with selected teams, seeds, and formats.
- Supporting group stages, round robins, Swiss stages, single elimination, double elimination, and other applicable formats.
- Supporting best-of-one, best-of-three, best-of-five, and other series lengths.
- Accurately modeling advancement rules, tiebreakers, side selection, and bracket placement when applicable.
- Allowing users to manually predict match winners or automatically simulate results.
- Configurable team strength ratings, win probabilities, and randomness.
- Running thousands of simulations to estimate championship probabilities, advancement rates, and likely placements.
- Comparing simulated results against actual historical results.
- Saving, sharing, exporting, and replaying simulation scenarios.

The simulation engine should be separate from the frontend and historical data ingestion systems.

Tournament rules should be data-driven and versioned wherever practical, allowing different years to use different formats without hardcoding every tournament into the application.

Explore multiple simulation models, ranging from simple Elo-based predictions to more sophisticated statistical approaches. Recommend an initial approach that balances realism, maintainability, explainability, and available historical data.

Simulation outputs must be clearly distinguished from actual historical results.

## 2. Historical Data Collection and Integration

Research how we can reliably obtain historical and current professional League of Legends tournament data.

Investigate potential sources including:

- Riot Games official APIs and esports data services.
- Leaguepedia and available MediaWiki/Cargo APIs.
- Oracle's Elixir historical datasets.
- Games of Legends.
- Community-maintained datasets and GitHub repositories.
- Other reliable esports statistics providers.

For each candidate source, evaluate:

1. API availability and documentation.
2. Historical coverage by tournament and year.
3. Available data fields and granularity.
4. Authentication and rate limits.
5. Licensing, attribution, and permitted automated access.
6. Reliability, maintenance, and long-term availability.
7. Ease of integrating and normalizing the data.
8. Whether scraping is necessary, technically feasible, and permitted.

Prefer documented APIs and structured datasets over scraping. Do not bypass access restrictions or anti-bot protections.

Propose a modular data ingestion architecture that supports multiple independent data providers.

The ingestion pipeline should support:

- Importing one specific tournament and year.
- Importing all available historical tournaments.
- Refreshing previously imported records.
- Incremental updates for ongoing tournaments.
- Idempotent imports and duplicate prevention.
- Data validation and integrity checks.
- Normalization of teams, players, matches, and tournament identifiers.
- Source attribution and provenance.
- Detecting conflicting records from multiple providers.
- Graceful handling of missing or incomplete information.
- Import logging, error reporting, and recovery.
- Reproducible imports and versioned corrections.

Historical data should not be silently overwritten when a provider changes its records.

Investigate whether the entire historical dataset can reasonably be maintained in the repository, whether a database is more appropriate, or whether a hybrid approach would be preferable.

## 3. GitHub Actions and Data Synchronization

I would like to explore using GitHub Actions for historical data imports and synchronization.

At minimum, consider a manually triggered workflow using `workflow_dispatch` with configurable inputs:

- Tournament: `worlds`, `msi`, `first-stand`, or `all`.
- Year: a specific year or all supported years.
- Operation: `import`, `refresh`, `validate`, or `dry-run`.
- Data provider: automatic selection or a specific provider.
- Force refresh: optional, with appropriate safeguards.

The workflow should:

1. Validate user inputs.
2. Retrieve data from the selected provider.
3. Normalize and validate records.
4. Detect changes and duplicates.
5. Produce an import summary.
6. Report missing or conflicting data.
7. Persist changes safely using an appropriate strategy.
8. Avoid unnecessary commits or writes when nothing changes.

Explore whether scheduled synchronization would be useful during active tournaments.

Consider GitHub Actions permissions, secrets, API rate limits, caching, concurrency, retries, execution costs, and failure recovery.

Evaluate whether data updates should create pull requests for review, commit directly, update a database, or use another approach.

Do not assume GitHub Actions is the best solution for every ingestion operation. Recommend alternatives where appropriate.

## 4. User Experience and Interface

I want this to feel like a polished esports platform, not just a basic statistics dashboard.

Explore useful pages and interactions such as:

### Tournament Explorer
- Browse tournaments by type and year.
- Interactive brackets and standings.
- Tournament timelines and stage navigation.
- Match details and results.
- Historical rosters and participating teams.
- Tournament format explanations.

### Simulation Studio
- Select a historical or custom tournament.
- Modify participants, seeds, and match outcomes.
- Run simulations individually or in batches.
- Visualize brackets updating as matches are simulated.
- Display championship and advancement probabilities.
- Compare simulations against actual tournament results.
- Save and revisit simulations.

### Statistics and Analytics
- Team and regional performance comparisons.
- Historical head-to-head records.
- Championship and finals appearance counts.
- Win rates and tournament records.
- Performance trends across multiple years.
- Interactive charts and visualizations.

### Additional Features

Brainstorm other features that would make this project genuinely interesting.

Examples worth considering:

- "What if?" historical tournament scenarios.
- Cross-era team comparisons.
- Alternative bracket and seeding experiments.
- Tournament format comparisons.
- Upset probability analysis.
- Monte Carlo simulation distributions.
- Regional strength comparisons.
- Historical power rankings.
- Prediction challenges.
- Shareable simulation results.
- Import/export functionality.
- Dark mode and responsive layouts.
- Accessible, keyboard-friendly interfaces.

Do not assume every feature must be implemented immediately. Identify which features belong in the MVP, which should follow later, and which are experimental.

## 5. Architecture and Technology

Research and recommend a suitable technology stack.

I want the project to follow modern software engineering best practices while remaining practical for a personal, potentially public, open-source project.

Evaluate:

- Frontend framework and styling system.
- Backend architecture, if necessary.
- Simulation engine design and language.
- Database and storage options.
- Data ingestion and processing tools.
- API design and schema validation.
- State management.
- Testing frameworks.
- Deployment and hosting.
- CI/CD and GitHub Actions.
- Observability and error handling.

Prioritize:

- Modularity and separation of concerns.
- Maintainability and readability.
- Strong typing where appropriate.
- Minimal unnecessary dependencies.
- Reproducible development environments.
- Testability.
- Performance.
- Security.
- Scalability where justified.
- Clear documentation.
- Low ongoing operational cost.

Avoid premature microservices, excessive abstractions, and unnecessary infrastructure.

Recommend whether a monorepo, single application, or another structure makes the most sense.

Include a proposed repository directory structure and explain the responsibilities of major components.

## 6. Engineering Quality and Workflows

Design a professional development workflow covering:

- Git branching and pull request conventions.
- Formatting, linting, and static analysis.
- Unit, integration, and end-to-end testing.
- Automated CI checks.
- Dependency management.
- Dependency and security scanning.
- Environment configuration.
- Secret management.
- Database migrations, if applicable.
- Release and deployment processes.
- Documentation standards.
- Contributor guidance.
- Data ingestion testing and validation.
- Simulation reproducibility.

For the simulation engine specifically, consider:

- Deterministic simulations using configurable random seeds.
- Unit tests for tournament rules and advancement logic.
- Historical tournament fixtures as regression tests.
- Statistical validation of probability calculations.
- Performance tests for large Monte Carlo simulation batches.

For data ingestion, ensure that a failed import cannot corrupt or partially overwrite previously validated records.

## 7. Data Modeling

Propose a normalized data model that supports historical accuracy.

Consider entities such as:

- Tournament
- Tournament edition
- Stage
- Group
- Bracket
- Match series
- Individual game
- Team
- Historical team identity
- Player
- Roster membership
- Region
- Qualification seed
- Tournament ruleset
- Tournament result
- Statistical record
- Data source
- Import run
- Simulation scenario
- Simulation result

Account for organizations changing names, players transferring teams, regions being reorganized, and tournaments changing formats.

Avoid using mutable team names or display labels as primary identifiers.

## 8. Research and Planning Process

Before implementation, I want you to:

1. Inspect the current repository and development environment.
2. Research viable data sources and verify actual availability.
3. Identify data coverage gaps and external dependencies.
4. Ask me clarifying questions about project goals, scope, technology, hosting, and user experience.
5. Propose multiple reasonable architectural approaches where meaningful tradeoffs exist.
6. Recommend an architecture and explain why.
7. Design the initial data model and ingestion strategy.
8. Define the simulation engine's boundaries and initial algorithms.
9. Propose a GitHub Actions and CI/CD strategy.
10. Organize the feature set into MVP, subsequent phases, and optional enhancements.
11. Create a phased implementation roadmap with clear deliverables and acceptance criteria.
12. Identify technical risks, limitations, and unresolved decisions.

Do not present unverified assumptions as established facts.

When researching third-party integrations, distinguish between officially supported APIs, community-maintained interfaces, downloadable datasets, and scraping.

## 9. Collaboration Expectations

You are encouraged to challenge my ideas and recommend better approaches.

If a feature is impractical, expensive, difficult to maintain, or limited by unavailable data, explain why and propose alternatives.

Ask questions in logical groups and explain the impact of important decisions. There is no strict limit on the number of questions you may ask.

Do not prioritize agreeing with me over producing a better architecture.

However, avoid unnecessary questions about minor implementation details that can be reasonably deferred.

**Do not start writing application code until I approve the implementation plan.**

## 10. Expected Planning Deliverables

Before implementation, I would like:

1. A summary of your understanding of the project.
2. A researched comparison of historical esports data sources.
3. A proposed feature list organized by priority.
4. Recommended technology stack with rationale.
5. Proposed architecture and repository structure.
6. Initial database/data schema.
7. Data ingestion and GitHub Actions workflow design.
8. Tournament simulation engine design.
9. UI/UX page and navigation plan.
10. Testing, CI/CD, and deployment recommendations.
11. A phased roadmap with milestones and acceptance criteria.
12. Outstanding questions requiring my decisions.

**Start by reviewing the project concept, researching the data acquisition options, and asking your first round of clarifying questions. Do not implement anything yet.**