# Proposal

## Why

Awards category names and descriptions are stored as a single admin-entered text, and most of it is Portuguese. As a result, an English-speaking user sees English interface text next to Portuguese category titles and descriptions on the ballot, nominations and results pages. Before the 2026 voting window opens, each category needs content in both supported languages (`en` and `pt-BR`).

## What Changes

- Add a normalized `awards_category_translation` table with one row per category and locale (`en` or `pt-BR`). Each row holds a `name` and a `description`, and `(categoryId, locale)` is unique.
- The existing `name` and `description` on `awards_category` remain the required base (fallback) text, so existing categories and clients keep working.
- Every API response that contains a category includes `translations`, an array of `{ locale, name, description }` that is empty (`[]`) when there are none. This applies to:
  - the categories-by-event endpoint
  - the `category` inside category results
  - the ballot categories
  - admin reads
- The admin create/update category endpoint accepts `translations` as an array. Validation:
  - each item needs a supported `locale` plus a non-empty `name` and `description`
  - a request with duplicate locales is rejected
- Saving through the admin endpoint replaces the category's full set of translations in one transaction:
  - leaving `translations` out on update keeps what is stored
  - `[]` clears it
- The server does not choose a language, has no `locale` query parameter, and does not key caches by locale. Clients pick the entry for their locale and otherwise use the base text.
- A migration creates the table, with a foreign key that cascades on category delete.
- The OpenAPI schema describes `translations` as a typed array, so the generated client wrapper is typed.

## Capabilities

### New Capabilities
- `awards-category-translations`: per-locale name and description for Awards categories. Covers how they are stored, how admin writes are validated, how every category read exposes them, and the fallback contract clients rely on.

### Modified Capabilities
<!-- None: the awards capabilities (awards-events, awards-ballot, awards-results) live in the unarchived change add-2026-recap-and-awards-events and have no main spec yet. This change adds a related collection without changing their requirements. -->

## Impact

- **Entities:**
  - a new `src/awards/entity/awards-category-translation.entity.ts`
  - a `translations` one-to-many relation on `awards-category.entity.ts`
  - the new entity registered in `awards.module.ts`
- **Migration:** a new migration after `1795300000000-Add2026RecapAndAwardsEvents` that creates the table, the unique index and the cascading foreign key.
- **DTOs:**
  - a `CreateUpdateAwardsCategoryDto` with optional validated `translations`
  - an `AwardsBallotCategoryDto` with `translations`
  - `VotableAwardsCategoryDto` inherits the relation from the entity
- **Services:** the categories, ballot and results reads load the relation. The admin service replaces the set inside a transaction.
- **OpenAPI:** a schema change that only adds fields. Clients regenerate `@repo/wrapper` from the updated `server_swagger.json`; this is tracked in the clients change `localize-awards-category-content`.
- **Caching:** no change. Translations ride along in the same cached payloads, so admin edits show up after the existing TTLs expire.
