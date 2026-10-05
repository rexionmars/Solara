# TODO

Solara product backlog, prioritized based on its current scope as a geospatial screening tool for renewable energy projects. These tasks preserve the distinction between preliminary screening and formal feasibility studies.

## Priority 1: turn analysis into decisions

- [ ] **Compare candidate sites in a portfolio view.** Bring site and area results together in a comparable table, with filters for product, status, and data quality.
  - Acceptance criterion: every compared value identifies its unit, source, date, assumptions, and status (current, stale, or unavailable).
  - Acceptance criterion: there is no single opaque "viability" score; criteria and exclusion reasons remain visible separately.
- [ ] **Generate a shareable study report.** Export a document for a project or site with a map, summary of findings, parameters, sources, run date, and limitations.
  - Acceptance criterion: the report is understandable without opening Solara and distinguishes modeled, observed, and missing values.
  - Keep the Reports editor for messages and operational history; the study report is a separate deliverable.
- [ ] **Make data quality and uncertainty explicit alongside conclusions.** Consolidate temporal coverage, resolution, quality, caveats, and sensitivity to assumptions for each product.
  - Acceptance criterion: users can identify what is robust, what depends on an assumption, and what requires external validation.
  - Acceptance criterion: missing data is never presented as zero or as favorable evidence.

## Priority 2: reduce adoption friction

- [ ] **Add a guided first-analysis workflow.** Guide users through creating or opening a project, choosing a location, selecting a product, and running an analysis without removing the advanced editors.
  - Acceptance criterion: a new user can run a solar or terrain analysis without prior knowledge of the studio model.
- [ ] **Add installation and dependency diagnostics.** Show the status of the Python sidecar, optional grid store connection, internet access, and external service availability.
  - Acceptance criterion: each failure identifies the affected product, the known cause, and a possible action; unaffected products remain usable.
- [ ] **Add Brazilian Portuguese UI and documentation.** Translate primary workflows, messages, labels, and help while keeping units and terminology consistent.
  - Acceptance criterion: there is no unintended language mixing within a workflow; "consumption" and "demand" retain distinct meanings.
- [ ] **Show data freshness and provenance consistently.** Display source, period, resolution, and retrieval or update date where relevant.
  - Acceptance criterion: layers and results distinguish recent data, climatology, reanalysis, historical records, and unavailable data.

## Priority 3: clarify product positioning

- [ ] **Document target users and the decisions they need to make.** Define priority audiences (for example, project developers, consultants, and planners) and which decisions the tool supports at each stage.
  - Acceptance criterion: each product states the question it answers, its inputs and outputs, its limitations, and the recommended next decision.
- [ ] **Define the boundary between screening and feasibility.** Make clear that grid, terrain, and resource analyses do not replace an access opinion, on-site measurements, permitting, or a financial study.
  - Acceptance criterion: the UI and reports retain these caveats wherever results could be mistaken for a final decision.
- [ ] **Evaluate future integrations without expanding scope prematurely.** Investigate land ownership, environmental constraints, logistics, permitting, and cost data as optional sources or modules.
  - Acceptance criterion: before an integration enters the product, document its source, coverage, license, maintenance cost, and confidence level.

## Out of scope for now

- [ ] Do not present an opaque viability score or promise of grid connection.
- [ ] Do not treat current results as substitutes for measurements, regulatory opinions, environmental studies, or financial assessment.
- [ ] Do not add new analyses before improving comparison, interpretation, and sharing of existing results.