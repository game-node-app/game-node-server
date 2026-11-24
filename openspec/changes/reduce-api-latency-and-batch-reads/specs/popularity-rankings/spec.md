# Spec Delta

## MODIFIED Requirements

### Requirement: Public ranking pages share a bounded cache
Public pages with identical selectors SHALL share cache entries across authenticated and anonymous callers. Actor identity SHALL partition review exclude-own requests. For prepared game rankings keyed by a published `ranking_score` calculation timestamp (`asOf`), both the filtered total and full page responses MAY be cached until the next scheduled score publication (bounded by the 6-hour refresh window) so consecutive pages reuse the filtered total without repeating full counts, and publishing new prepared scores SHALL supersede earlier cached entries via the updated `asOf` key. Common prepared game rankings SHALL warm their default first page upon score refresh. Review rankings and explicit-interval rankings MAY remain cached for at most 15 minutes and SHALL revalidate current eligibility and filtered totals on every read.

#### Scenario: Several actors request the same public page
- **WHEN** different authenticated users and an anonymous caller request a public ranking with identical selectors
- **THEN** they reuse the same eligible cached page

#### Scenario: Prepared scores refresh before the cached page expires
- **WHEN** the scheduler publishes a new calculation for the requested prepared key
- **THEN** the next read observes the new `asOf` timestamp and uses the new calculation instead of the earlier cached page

#### Scenario: Paginating past the first prepared game page reuses the filtered total
- **WHEN** a caller requests page 1 (`offset: 0`) and then page 4 (`offset: 60`) of a prepared game ranking with identical filters within the same `asOf` publication
- **THEN** the deep page reuses the cached filtered total rather than re-running the full filtered count query

#### Scenario: Cold first page after refresh is pre-warmed
- **WHEN** the scheduled ranking refresh completes for common prepared game keys
- **THEN** the default first page for those keys is populated in cache so the first user request does not pay cold query latency

### Requirement: Ranking reads use prepared bounded data
Common ranking requests SHALL read prepared scores directly from `ranking_score` without full catalog table scans or derived-table score materialization, driving prepared game queries from positive-score `ranking_score` rows joined to `game` and `statistics_target`. Explicit intervals SHALL use temporal aggregates with exact boundary handling. Requests SHALL NOT hydrate the complete catalog or complete raw history into application or cache memory. Cache loss SHALL affect speed without losing statistics.

#### Scenario: Catalog size grows
- **WHEN** a page of 20 games is requested from a larger catalog
- **THEN** the application reads from positive prepared scores and fetches a limited page without scanning unscored catalog rows or loading a catalog-sized statistics array

#### Scenario: Result cache is empty
- **WHEN** a ranking is requested after cache eviction
- **THEN** it can be produced from persisted statistics with the same eligibility and score semantics
