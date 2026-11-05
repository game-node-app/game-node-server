# Design

## Context

See `proposal.md` for motivation and production observations. `StatisticsRankingService.sourceQuery()` builds game eligibility (active target, no mature theme, default categories, explicit criteria). `readRankings()` joins prepared or interval scores with `score > 0`, counts the total, revalidates cached pages with the same `source.where`, and `gameRankingPage()` orders by `prepared.score DESC, g.id ASC`. Prepared scores are written for every game regardless of eligibility, so eligibility is purely a read-time concern. `DailyPoolService` already gates on `aggregatedRatingCount` using the same IGDB column.

## Goals / Non-Goals

**Goals:** Add the eligibility rule and tie-breakers inside the existing game source query and page query, so totals, pagination, and cache revalidation stay consistent automatically.

**Non-Goals:** No change to scoring (`engagement-v1`), prepared-score refresh, view capture, bot detection, review rankings, schema, or indexes. No configurable thresholds or client options.

## Decisions

### Gate eligibility in `sourceQuery()`

Add `(g.aggregatedRatingCount >= 1 OR g.firstReleaseDate > ?)` to the game `where` list, bound to the request's `asOf`, next to the mature exclusion. Because count, page, and `countCachedMembers()` all use `source.where`, they stay consistent without further changes. The rule is unconditional (unlike the default category list) because it exists to protect public lists, the same way the mature exclusion does.

The threshold is 1, matching `MINIMUM_CRITIC_REVIEWS` in the daily pool. A shared constant is not introduced: the two features may diverge, and the daily constant is private to its service.

Alternatives considered:
- **Critic count only as a tie-breaker:** simulated on production data, it left Widget, Popgoes Evergreen, Anime Poly Puzzle and similar games in the top 20 because they tie at a higher score than reviewed games.
- **Exemption for recently released games (90 days or 1 year):** the 2026-11-05 sample in those buckets was mostly obscure indie titles. Critic reviews for notable releases usually appear at launch, so only upcoming games are exempted.
- **Exemption for unknown release dates:** that bucket held 1,263 unreviewed ranked games, 681 without themes. It is excluded.

### Replace the bare ID tie-breaker

`g.id ASC` exists because the spec requires a unique, deterministic final key: without it, MySQL may order ties differently between `LIMIT/OFFSET` requests and pages can repeat or skip games. It is not useful as the first tie-breaker, because IGDB IDs only reflect when IGDB created the entry. The new order is:

```
prepared.score DESC,
COALESCE(g.aggregatedRatingCount, 0) DESC,   -- recognition, same signal as search and daily
g.firstReleaseDate DESC,                     -- newer first; MySQL sorts NULL last in DESC
g.id ASC                                     -- unique final key for stable paging
```

Alternatives considered for the second and third keys:
- **`aggregatedRating` (critic score):** measures quality, not recognition, and is noisy with one or two reviews.
- **Views or likes counts:** they are already part of the score, and anonymous views are the noise source.
- **Name:** arbitrary.

Release date descending fits a "trending" list and matches the secondary key used by search ordering.

### Performance

The read is driven by the `ranking_score` covering range scan (`rankingKey`, `score > 0`), then a single-row lookup on `game` by `statisticsTargetId`. The new columns are read from that row, so the covering game index is not needed for this path. `EXPLAIN ANALYZE` of the proposed page query on production data (2026-11-05, month key) took about 121 ms and examined 9,682 prepared rows, leaving 1,828 eligible. No new index is proposed.

### Cache namespace

Bump the page-cache key prefix (`statistics:rank:v2` to `v3`). Revalidation would reject many old pages through the total and member checks, but it cannot detect a pure reordering, so old pages could otherwise be served for up to 15 minutes.

## Risks / Trade-offs

- [Critic coverage favors established platforms and mainstream releases] → This is intended for a public discovery list. Search and game pages keep every game accessible.
- [A game disappears between its release date and IGDB receiving critic reviews] → Usually short for notable releases with review embargoes, and IGDB delta polling keeps counts fresh. Revisit with a grace window only if observed.
- [Upcoming-date exemption admits obscure or cancelled future-dated entries] → In the 2026-11-05 sample, only 19 unreviewed upcoming games had any score, and they were mostly recognizable. Status-based filtering is deferred.
- [Mature content with critic reviews but no mature theme remains eligible] → Unchanged behavior. Observed cases (GTA V, Bayonetta) are mainstream titles.
- [Smaller results and totals] → Expected. Clients already handle short pages and accurate totals.

## Migration Plan

Deploy the service change. There is no migration or backfill. The cache-prefix bump discards old pages on deploy. Rollback is a plain redeploy of the previous image; old cache keys simply expire.
