# Design

## Context

See `proposal.md` for motivation and the two delta specs for the behavior contract. A design is warranted because matching, index contents, pagination, and deployment must change together.

`SearchService.buildGameSearchRequest()` currently sends `match_phrase` over `name,alternative_names` with a prepended `^` and an appended `*` for autocomplete. It sorts by `_score`, `num_views`, release timestamp, and ID. Autocomplete delegates to the same execution path; MCP game search also delegates to this service. The index template uses a plain SQL source, aggregates alternative names into one comma-separated field, enables `expand_keywords = 1`, and does not select `aggregatedRatingCount`. Existing response mapping already understands the optional `aggregated_rating_count` field.

The current `search-api` spec promises anchored phrase matching and views-based ordering; `search-indexing` promises preservation of matching settings. This change deliberately replaces those promises. Phrase matching anywhere within an individual name remains useful; automatic inside-word expansion is removed, and incomplete final words belong to autocomplete.

Read-only production observations from the exploration on 2026-11-05:

- Minecraft: Legends had a higher engine score than Minecraft: Java Edition; the latter appeared at position 100 despite having 14 critic reviews versus Legends' 5. Critic-first simulation surfaced Java Edition. This is a dated catalog observation, not a permanent fixture expectation.
- Straight and curly apostrophes produced equivalent results, but `Im on Observation Duty` failed while the apostrophized title matched. `CALL KEYWORDS` showed `im` versus separate `i` and `m` tokens.
- Composed Pokémon and unaccented Pokemon agreed; decomposed `e` plus combining acute produced different matches. Normalizing only display text would not fix indexing/query parity.
- The initially reported image slogan was subsequently identified by the user as Dead or Alive 5 and is excluded from this work.

## Goals / Non-Goals

**Goals:** Keep matching, exact-match priority, critic ordering, and pagination in the engine; extend the existing service/template/test harness without another search backend. Validate the real index, not only mocked request shapes.

**Non-Goals:** No catalog eligibility policy, generic ranking framework, configurable weights, MySQL schema changes, new packages, semantic search, typo correction, contraction expansion (`I'm` to `I am`), or client API redesign.

## Decisions

### Normalize game text consistently in the existing index

Use the games table's native character mappings and ignored-character/tokenization settings for Latin accent folding, combining marks, and in-word apostrophes. Normalize incoming Unicode consistently in the shared game-query path using platform string operations as needed. In particular, apostrophes must be omitted rather than replaced with spaces so `I'm` and `Im` share tokens; combining marks must not split words. Keep stored/displayed fields unchanged and scope index settings to games, not users. Do not indiscriminately delete all punctuation or discard non-Latin characters.

This avoids a second importer or maintaining normalized catalog columns. Native settings apply during both indexing and querying; equivalence for composed/decomposed indexed names and input must be verified in the pinned engine harness. Relevant engine behavior: [tokenization and ignore_chars](https://manual.manticoresearch.com/Creating_a_table/NLP_and_tokenization/Low-level_tokenization). Query-only apostrophe stripping is insufficient because the current index stores separated tokens.

### Represent exact names and alias boundaries in the index

Keep one engine document per game. Add an internal exact-name full-text field containing boundary-marked versions of the title and each individual alias, produced by the existing SQL source. Use dedicated start/end tokens and a quoted phrase containing both boundaries for an exact match. Apply the same native normalization to this field. Separately preserve boundaries between aliases for ordinary phrase matching so adjacent aliases cannot form a false phrase. Retain the original response fields.

The markers are internal literals, with collision-safe escaping/encoding of source content and query input; test marker-like input explicitly. A single anchored phrase over the existing comma-joined aliases cannot identify an exact alias in the middle, and treating the concatenation as one title is incorrect. Do not create one document per alias, which would complicate identity, totals, and deduplication.

The games SQL source selects `exact_names` as its first full-text field, followed by `name_search`. It scrubs marker-like source text with case-insensitive `REGEXP_REPLACE` before adding `gnnamebegin`, `gnnameend`, and `gnaliasboundary`. `alias_data_complete` compares the generated boundary counts with the source alias count; the integration fixture verifies a middle alias and a 70 KiB+ aggregate after raising `group_concat_max_len` to 16 MiB. A zero completeness flag means the aggregate may have been truncated and blocks promotion until the limit or source is addressed.

Pinned-engine verification confirmed this ranker/expression pair with `track_scores: true` and `exact_names` in field-mask bit 0:

```text
ranker: expr(IF(field_mask & 1, 1000000000, 0) + sum(lcs*user_weight)*1000 + bm25)
exact_match: IF(WEIGHT() >= 1000000000, 1, 0)
text_relevance: IF(WEIGHT() >= 1000000000, WEIGHT() - 1000000000, WEIGHT())
```

Engine-backed assertions return `exact_match = 1` for a complete alias and `0` for a phrase contained within it, while both expose positive textual relevance. The final sort uses these expressions as separate tuple components; it does not sort by their combined `_score`.

### Use explicit phrase semantics and a global sort tuple

Normalize input with NFD, remove combining marks, omit straight/curly apostrophes, replace internal marker names with harmless words, and turn punctuation/symbol operators into token separators. Build ordinary and exact-name phrase clauses only from those normalized tokens. Autocomplete adds a wildcard only to the final token; regular search never receives user-controlled wildcard syntax. Disable automatic keyword expansion for game queries. Preserve the existing category/status/relation filters and query bounds. A nonblank query normalized to no searchable text returns empty results instead of becoming `match_all`.

Derive an engine-side exact-match flag and textual relevance using the native ranker/expression facilities and the isolated exact-name field. The tuple is `exact_match DESC, aggregated_rating_count DESC, text_relevance DESC, first_release_date DESC, id ASC`; omit text-dependent preferences for browse. Exact title and exact alias share one tier. Do not approximate that tuple by adding critic counts to a relevance score: no critic count may overtake exact priority, and textual relevance may not overtake critic count within a tier. Verify the derived expressions with the real engine before wiring the final request type.

Select `COALESCE(game.aggregatedRatingCount, 0)` as a sortable numeric attribute in the games source. Preserve views/likes for response compatibility, but remove them from sorting. No `WHERE` clause, join, minimum count, or category gate is added for critic coverage. This is independent of daily-pool eligibility.

Perform the complete sort before offset/limit. No application-side reranking of the first page or a fixed candidate sample is allowed. Reuse `executeGameSearch()` and its existing response mapping, totals, error translation, and timeout. Internal markers, expressions, and ranking flags must not leak into the public DTO.

Native expressions and rankers are available in the pinned engine: [expressions](https://manual.manticoresearch.com/Searching/Expressions), [ranking](https://manual.manticoresearch.com/Searching/Sorting_and_ranking). Exact expression syntax is an implementation detail to verify against Manticore 29.9.0; it does not change the tuple or document model.

### Extend the current verification and deployment paths

Extend the existing deployment/unit tests and the disposable MySQL 8.4.13 + Manticore 29.9.0 harness. Add fixtures for original/spinoff/alias names, high-view unreviewed matches, null/zero critic counts, normalization, alias boundaries, literal query operators, and multiple pages. Assert result membership and order, not incidental numeric `_score` values. Exercise both HTTP paths, autocomplete, existing filters, and the MCP delegating caller. Preserve username tests.

## Risks / Trade-offs

- Critic coverage favors some periods, platforms, and editions -> keep zero/null games eligible, promote exact normalized names first, and describe coverage as a recognition proxy.
- Normalization merges spellings and can alter punctuation handling -> restrict transformations to the agreed equivalences, retain names, and test non-Latin/punctuation regression inputs without introducing new search features.
- Auxiliary name data and boundary markers can increase index size or be truncated by existing `GROUP_CONCAT` limits -> include alias ordering/boundary and aggregation-limit fixtures; ensure truncation is detected or prevented using the existing indexing path rather than silently losing exact aliases.
- Ranking expressions and prefix handling can vary by engine version -> use pinned-engine integration assertions, including multiple aliases and completed versus incomplete query words.
- New API requests against an old games index can fail -> coordinate index rebuild and API activation; retain the serving index on build failure. No silent views-based fallback is introduced.
- Different ordering is intentional -> preserve response shape, client filters, full-set totals, and stable pagination.

## Migration Plan

1. Build and verify the updated games index and queries in the disposable harness; run search unit/integration suites and typecheck.
2. Update `docs/search-cutover-runbook.md` with the exact coordinated rollout procedure for the new index fields and normalization. Keep the old serving artifacts and matching API revision available for rollback. Reuse the current serialized build/rotation tooling.
3. In deployment, stage and verify the new games index before activating the API that requires its attributes. If template/tokenizer changes require a searchd reload or restart, document and perform it within that coordination; an API-only rollout or an unchanged-index rotation is insufficient.
4. Smoke-test Minecraft, contraction/accent variants, null/zero coverage, filters, pagination, and user lookup. Compare game membership before and after rebuild to ensure no critic-coverage filtering was introduced. Production mutation or deployment is not part of creating or applying this source change unless separately requested.
5. If rollout fails, restore the previous API and matching index/config together. Preserve the MySQL catalog, daily puzzles/results, and index volumes; a failed build must leave the last working index serving.
