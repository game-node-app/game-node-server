# Design

## Context

See `proposal.md` for motivation and `specs/daily-answer-selection/spec.md` for the behavior contract.

`DailyPoolService.pick()` first samples from the top 1,000 positive `game:popular:all` ranking scores, then tries the top 1,000 main games ordered by `aggregatedRatingCount`. Neither source requires a minimum critic-review count. Mode and repeat filters currently run after each source limit. Metadata creation selects an artwork or shuffles keyword IDs once per generated puzzle.

`Game` already stores nullable `aggregatedRatingCount`; no import or schema extension is needed. Public popularity rankings measure local views and likes and have their own contract. `DailyScheduler` fills missing slots from today through seven days ahead on bootstrap and daily at 00:05 São Paulo time. It already handles a null pick by warning and skipping insertion, and does not replace existing rows. Existing controller integration tests create explicit puzzles and do not exercise candidate selection.

### Production evidence

Read-only queries through SSH `gamenode-vps` against the GameNode MySQL resource identified by Coolify, sampled on 2026-11-05 around 01:47–01:51 UTC (2026-11-04 São Paulo). Sessions used read-only transactions and a 20-second SELECT execution limit; no production records or configuration were changed. Counts are observations of a live catalog, not permanent guarantees.

- Catalog snapshot: 386,477 games, including 322,899 main games. Of all games, 369,539 have a null critic count and 320 have zero; treating missing coverage as zero gives a catalog median of zero. Among the 13,611 reviewed main games without theme 42, the median is 2; the maximum observed critic count is 52.
- IGDB defines `aggregated_rating_count` as its count of external critic scores. GameNode imports this as `aggregatedRatingCount`. It differs from GameNode user reviews and IGDB's `rating_count` community-rating field. Source: https://api-docs.igdb.com/#game.
- Reported game ID 77048, **ClueFinders 5th Grade Adventures: The Secret of the Living Volcano**, has a null critic count and a prepared all-time popularity score of 1. It is the automatic keywords answer for 2026-11-04. The proposed floor excludes it.
- Prepared all-time popularity contains 5,335 positive-score games; 5,206 (97.6%) have score 1. One execution of the current top-1,000 source returned 913 unreviewed games. Membership among tied scores is not deterministic in the current query, so this is a reproduction, not a fixed membership claim.
- Live game metric totals separately contain 7,528 positive weighted scores, of which 7,287 have score 1. The prepared all-time key was computed at 18:01 UTC while finite-period keys were computed around 00:00 UTC. Snapshot freshness contributes to differences; this investigation does not diagnose or modify ranking refresh behavior.

Eligible pools below apply category, mature-theme, and mode filters before the cap. Available counts include the existing same-mode history and queued reservations, relative to 2026-11-04 São Paulo.

| Minimum external critic scores | Cover | Artwork | Keywords | Specs |
| --- | ---: | ---: | ---: | ---: |
| 1 | 13,445 | 8,905 | 5,250 | 12,744 |
| 2 | 7,615 | 5,453 | 3,714 | 7,459 |
| 3 | 4,959 | 3,834 | 2,692 | 4,911 |
| 5 | 2,473 | 2,119 | 1,517 | 2,469 |
| 10 | 737 | 701 | 550 | 737 |
| 20 | 71 | 71 | 71 | 71 |

At the one-review floor, currently available counts are 13,444 / 8,905 / 5,246 / 12,743 respectively. All modes can supply the eight-slot horizon with substantial headroom. The proposed sorted top-1,000 available pools have minimum counts of 8 / 8 / 6 / 8 and medians of 11 / 11 / 10 / 11. Thus the hard floor is permissive while the cap and ordering presently provide a stronger practical filter. Sampled pool-edge titles include CrossCode, Kirby and the Rainbow Curse, Halo 2, and Halo 3: ODST; this is a plausibility check, not evidence of universal audience familiarity.

There are 28 queued future puzzles, seven per mode, and none has saved results. Of these, 22 fail the one-review gate (cover 6, artwork 7, keywords 3, specs 6). Preserve them under this plan's existing queue policy; the transition is measurable rather than hypothetical. Only 19 signed-in play records exist: 13 lost, 2 won, and 4 in progress. That sample excludes guest play and is too small for difficulty calibration or outcome-based ranking.

## Goals / Non-Goals

**Goals:** Put eligibility in one SQL selection path; preserve the picker return shape, metadata handling, and scheduler contract. Use the user-approved launch minimum of one critic review, with one named constant that can be raised in a later change.

**Non-Goals:** No new ranking formula, external calls, runtime configuration, curation UI, catalog migration, changes to hints or guess acceptance, or automatic rewriting of existing puzzles. Public ranking eligibility remains independent of daily-answer eligibility.

## Decisions

### One catalog pool with a critic-coverage floor

Remove `CANDIDATE_SOURCES` and its retry loop. Query `game` with `g.aggregatedRatingCount >= :minimum`, passing the equivalent positional parameter in the existing raw-query style. Define the minimum as a single module-local constant initialized to `1`; do not add an environment variable or policy framework. SQL comparison naturally excludes null counts.

Critic coverage is a launch proxy for recognition, not a measure of audience size or review quality. The user selected one review as sufficient for launch. Requiring local engagement as well would reject suitable games on a young site; allowing it as an alternative would preserve the bypass. Adding IGDB user-vote fields or a curated catalog would require more ingestion and maintenance work than this change needs.

The production evidence supports retaining the floor of one alongside the sorted cap. Raising it to 3 or 5 would also retain sizable pools, but would not change today's capped draws, whose effective floor is already 6–8. Twenty is unsustainable with only 71 eligible games per mode and a 365-day repeat window. Do not add a score-1 engagement gate or use the 19 play records to infer recognition.

### Filter, bound, then randomize

Inside a derived candidate query, apply the review floor and all existing category, mature-theme, mode-metadata, and repeat filters. Order by `aggregatedRatingCount DESC, id ASC` and limit to 1,000. Randomly select one ID from that bounded result in SQL, then call the existing metadata builder unchanged. Do not hydrate the pool into application memory.

This retains a simple random daily draw while favoring a pool with review coverage. Moving filters before the limit prevents unsuitable games from crowding mode-compatible candidates out. Preserve the existing date exclusion exactly, including future reservations and the strict 365-day boundary. Do not introduce cross-mode cooldowns or shrink the pool dynamically when it is exhausted.

### Keep exhaustion and stored puzzles stable

Return null when the query finds no candidate; retain the scheduler's warning, missing-slot retry, duplicate handling, and numbering behavior. No unrestricted fallback is permitted. Keep artwork and keyword selection, including their error behavior, unchanged.

Apply the policy only to new automatic puzzles. Existing auto and admin rows, including future rows, remain intact. This intentionally accepts the current seven-day queue transition and avoids adding a repair script or persistent reconciliation behavior. A faster queue replacement would need a separate request with explicit handling for identities, numbering, metadata, and any saved results.

### Test the actual selection query

Add a small MySQL-backed pool integration suite using `createNotificationTestDataSource`, as the existing daily integration suite does. Seed owned fixtures with review counts null, zero, one, and above one, mode metadata, mature/category exclusions, ranking presence/absence, and repeat reservations. Use isolated fixture identities and exact cleanup, never broad catalog deletion. Assert eligibility with a sole valid fixture where needed so random selection cannot make tests flaky. Add a focused scheduler test for null picks if needed to cover the empty-slot contract.

## Risks / Trade-offs

- [One external critic score does not guarantee familiarity] → Keep the sorted cap and inspect sampled candidates; raise the single threshold in a future policy change if needed. The reported title is confirmed excluded by its null count, but similar unfamiliar games with recorded scores can still qualify.
- [Review coverage favors some platforms and eras] → Sample titles across eras and platforms before rollout; do not impose an age cutoff that would independently exclude recognizable classics.
- [The smaller eligible population can exhaust a mode's 365-day window] → Count eligible and currently available candidates per mode and simulate the eight-slot generation horizon against reservations before deployment. Report shortages; do not silently relax either policy.
- [Filtering before the cap may increase database work] → Inspect the candidate query with EXPLAIN against representative data; retain bounded randomization and existing relationship indexes. Add an index only if measured execution warrants a separate concrete change.
- [Queued answers can retain the previous policy for up to seven days] → Document the transition, audit queued answers, and monitor newly generated slots separately.

## Migration Plan

1. Run focused pool/scheduler tests, existing daily regressions, and type checking. No migration or data backfill is required.
2. Add `docs/daily-answer-selection.md` with read-only audit queries matching the selection predicates: per-mode eligible/available counts, sampled titles and critic counts, queued answers, and a name lookup for the reported title. Carry forward this dated production baseline and rerun the audit before deployment; do not present these snapshot counts as live guarantees.
3. Deploy only after confirming the next eight slots per mode can be populated with the retained repeat policy. If coverage is insufficient, report it and revisit policy explicitly before deployment.
4. Let existing queued puzzles drain naturally. Verify new automatic rows meet the floor, preserve metadata, and emit no unexpected exhaustion warnings. Preserve historical/current puzzles and all results.
5. Roll back the picker code if necessary. Retain all stored puzzles and results; rollback changes future generation only and must not delete player progress.
