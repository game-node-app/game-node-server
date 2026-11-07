# Proposal

## Why

Trending game pages are dominated by obscure, often unclassified catalog entries, and adult games can slip past the mature-theme filter when IGDB never assigned them themes. Engagement history is still young and sparse: almost every ranked game has one or two points, so most positions are decided by the native ID tie-breaker, which favors old IGDB entries rather than anything meaningful.

Read-only production observations on 2026-11-05 (`game:popular:month`, history since 2026-10-30):

- 99.4% of 10,475 accepted views were anonymous. Since 2026-11-04 they arrived as a flat ~250/hour, almost one view per distinct game, which is consistent with automated page crawling. Logged-in views landed on games with external critic reviews 67% of the time; anonymous views did so 19% of the time.
- 9,348 of 9,682 positively scored games had score 1. From roughly position 37 onward, the order was effectively `g.id ASC`.
- Of 9,252 eligible ranked games, 7,443 (80%) had no critic reviews, and 2,600 of those had no themes at all, so the mature-theme exclusion cannot see them. Among games with 5+ critic reviews, only 9 lacked themes.
- Requiring critic reviews removed the observed noise in the top results (for example Widget, Popgoes Evergreen, Anime Poly Puzzle: Sci-Fi Maidens, Seduce Me the Otome). Upcoming games such as Grand Theft Auto VI were the only clearly wanted entries lost, because critic reviews only exist after release.

## What Changes

- Game rankings additionally require at least one external critic review (IGDB `aggregatedRatingCount >= 1`), unless the game's first release date is after the ranking's calculation time (upcoming games stay eligible). This applies to every game ranking request, regardless of explicit criteria, like the mature-theme exclusion.
- Game ranking order becomes: score descending, critic review count descending, first release date descending (unknown last), game ID ascending. The ID stays only as the final unique key that keeps pagination deterministic.
- Totals, pagination, and cached-page revalidation use the same eligibility. Cached pages from the previous rules are discarded.
- Review rankings are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `popularity-rankings`: Game eligibility gains the critic-review/upcoming rule (and the already-shipped positive-score rule is recorded), and game ordering gains the critic-count and release-date tie-breakers before the native ID.

## Impact

- `src/statistics/statistics-ranking.service.ts` (game source eligibility, game page ordering, cache namespace), the `criteria` description in `src/statistics/dto/statistics-api.dto.ts`, `src/statistics/statistics-ranking.integration.spec.ts` fixtures and tie-order assertions, and `docs/statistics.md`.
- No schema change, migration, new dependency, or client contract change. Prepared scores keep every game, so the scheduler is unaffected. Clients see a different, smaller result set and totals.
- Out of scope: discounting anonymous or automated views (the root cause of the noise), content filtering beyond the existing mature theme, search ordering (`improve-game-search-relevance`), and daily answer selection.
