# Proposal

## Why

Production confirms that the reported ClueFinders answer has no external critic scores and a local popularity score of 1; one reproduction of the current primary pool included 913 unreviewed games out of 1,000. Answers should be recognizable enough for casual players to have a fair chance across cover, artwork, keywords, and specs modes.

## What Changes

- Replace the two candidate sources with one catalog pool requiring at least one external critic score collected by IGDB, using existing `aggregatedRatingCount` as a pragmatic recognition proxy for launch. GameNode user reviews, IGDB community ratings, and site engagement do not count toward this minimum.
- Apply the same gate to all four modes, alongside their existing metadata requirements, main-game and mature-content restrictions, and 365-day per-mode repeat exclusion.
- Randomly select from at most 1,000 qualifying games ordered by review count; filter for mode suitability before applying that cap.
- Never relax recognition requirements when the pool runs out. Preserve the existing no-candidate warning and retry behavior.
- Audit pool coverage and queued answers before rollout. Preserve published puzzles and results; document the existing seven-day queue transition instead of silently rewriting answers.

## Capabilities

### New Capabilities

- `daily-answer-selection`: Recognition eligibility, mode suitability, bounded random selection, exhaustion behavior, and stable published answers for daily puzzles.

### Modified Capabilities

None. Public popularity rankings retain their existing engagement semantics.

## Impact

- Change `src/daily/daily-pool.service.ts` and add focused selection tests using the existing MySQL test infrastructure; verify `DailyScheduler` remains compatible with the picker contract.
- Add rollout documentation covering per-mode capacity, the reported title, queued answers, and rollback.
- No API, DTO, evaluator, guess-search, entity, migration, importer, ranking formula, or dependency changes are required.
- Production auditing supports the chosen one-review floor: it permits 5,250 keyword answers and 8,905 artwork answers before repeats and the cap. Twenty reviews leave only 71 games per mode. The top-1,000 ordering currently raises the effective minimum to 6–8 reviews; keep the hard floor in one constant for later changes. Counts are a proxy, not a guarantee of familiarity; recheck coverage before deployment. Curated lists, difficulty tiers, personalized answers, keyword redesign, and external popularity feeds are outside this change.
