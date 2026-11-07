# Tasks

## 1. Eligibility

- [x] 1.1 Make the `createGame` helper in `src/statistics/statistics-ranking.integration.spec.ts` default to one critic review, so existing game ranking tests keep their current meaning. Verify that `yarn test:statistics` still passes before the service change.
- [x] 1.2 In `StatisticsRankingService.sourceQuery()`, add the game eligibility `(g.aggregatedRatingCount >= 1 OR g.firstReleaseDate > <asOf>)` next to the mature exclusion, bound to the request's calculation time. Thread `asOf` from `readRankings()` (refresh keeps calling it without a DTO, so it applies no eligibility). Verify with new integration cases: an unreviewed released game with the top score is absent from items and total; an unreviewed upcoming game is ranked; an unreviewed game with a null release date is absent; `criteria.ids` that select only an unreviewed released game return an empty page with total 0; and cached-page revalidation drops a game whose critic count is reset to 0.

## 2. Ordering

- [x] 2.1 Change `gameRankingPage()` ordering to `prepared.score DESC, COALESCE(g.aggregatedRatingCount, 0) DESC, g.firstReleaseDate DESC, g.id ASC`. Update the "native ID tie order" test to the new tuple, and add cases where (a) equal scores order by critic count against ID order, (b) equal score and critic count order by newer release date, with a null date last, and (c) full ties keep ascending ID across two consecutive pages with no repeat or skip.
- [x] 2.2 Bump the ranking page-cache prefix from `statistics:rank:v2` to `v3` in `cacheKey()`. Verify that the existing cache tests still pass with `yarn test:statistics`.

## 3. Contract and docs

- [x] 3.1 Update the `criteria` `@ApiPropertyOptional` description in `src/statistics/dto/statistics-api.dto.ts` to mention the critic-review/upcoming eligibility. Verify with `yarn build`.
- [x] 3.2 Update the ranking paragraphs of `docs/statistics.md` (eligibility, ordering, cache namespace) to match the delta spec. Verify that the doc no longer says "ordered by score then native ID" for games.

## 4. Integration check

- [x] 4.1 Run `yarn test:statistics`, `yarn build`, and `git diff --check`, and confirm that all pass.
- [x] 4.2 Run read-only `EXPLAIN ANALYZE` of the new month-key page query against production (or a production-sized copy). Record the latency in `docs/statistics.md` and confirm that the plan still drives from the `ranking_score` range scan.
