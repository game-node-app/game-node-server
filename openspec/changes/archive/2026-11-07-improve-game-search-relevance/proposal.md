# Proposal

## Why

Game search buries recognizable titles behind obscure editions and fan games because engine relevance outranks sparse local views. Contraction spelling and canonically equivalent accented input also produce inconsistent matches, affecting discovery and daily guess suggestions.

## What Changes

- Rank normalized exact title or individual alternative-name matches first, then external critic-review count descending, textual relevance descending, release timestamp descending, and game ID ascending.
- Use existing IGDB `aggregatedRatingCount` only for ordering. Null and zero counts remain searchable; add no review threshold, category restriction, or daily eligibility rule.
- Match the complete input phrase in names or individual aliases; autocomplete allows the last word to be incomplete. Prevent automatic infix expansion and alias aggregation from distorting intended phrase matching.
- Normalize case, Latin accents (including composed/decomposed Unicode), and straight/curly/omitted apostrophes consistently during indexing and querying, preserving displayed names.
- Apply the shared behavior to game search and autocomplete, preserving routes, response envelopes, explicit filters, bounded pagination, and user search.
- Rebuild the games index with critic counts and the internal data needed for matching and ordering; document coordinated rollout and rollback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `search-api`: Replace the current anchored-phrase/views ordering contract with normalized phrase matching, exact-name priority, critic-count ordering, and consistent autocomplete behavior.
- `search-indexing`: Include critic counts and boundary-preserving name data; use matching normalization compatible with the API while retaining every catalog game.

## Impact

- `src/search/search.service.ts`, its request types/internal helpers as needed, existing unit/controller tests, `docker/manticore/manticore.conf.template`, deployment tests, and `test/search/` fixtures/harness.
- `src/mcp/mcp-tools.service.ts` already delegates game searches to `SearchService`; verify the caller without introducing another search implementation. Existing HTTP clients and daily selectors inherit server results without a client contract change.
- Update `docs/search-cutover-runbook.md` for games-index schema/normalization deployment and rollback. No new dependency, MySQL entity/migration, catalog rewrite, or public API option is required.
- Daily answer selection, public popularity rankings, username search, fuzzy/semantic search, and matching image slogans are outside scope. In particular, `I'm a fighter` is not an acceptance case: the reported artwork belonged to Dead or Alive 5.
