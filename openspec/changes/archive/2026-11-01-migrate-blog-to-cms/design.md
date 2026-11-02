# Design

## Context

See [proposal.md](proposal.md) and the [investigation](../../../../game-node-clients/docs/blog-redesign-investigation.md). The user confirms that GameNode is not live, has no current users and has no blog data. Existing blog code and tables can be removed directly. Existing routes are convenient locations for the new readers, not a compatibility obligation.

`BlogPostService` currently uses TypeORM entities, while clients consume generated entity-shaped types and filename/extension covers. The detail reader loads Tiptap. Neither repository has a main blog specification. Checked-in Compose uses MySQL 8.3; compatibility and available host resources still need validation for the selected CMS version.

## Goals / Non-Goals

**Goals:** give the CMS sole editorial ownership and let NestJS deliver a small localized contract consumed by web/mobile. See the paired [clients design](../../../../game-node-clients/openspec/changes/migrate-blog-to-cms/design.md).

**Non-Goals:** backward compatibility, existing-content preservation, staged deployment, temporary editorial backends, custom SSO, slugs and automatic translation.

## Decisions

### 1. Validate one pinned CMS before adopting it

Trial one Directus instance with persistent SQLite, separate staff origin and isolated storage credentials. Record version-specific license eligibility, database support, writer acceptance, HTML edit/save/render results and resource usage. Use newly authored English/Portuguese articles, images and reviews as fixtures; there is no import corpus.

The owner has acquired an Open Innovation Grant license. Verify activation and custom access policies on the pinned Directus 12.6.0 instance before relying on them. Keep the completed Core trial results as historical evidence; they do not verify grant activation. Supply the key as a deployment secret, never in committed configuration or trial reports. The grant removes the Core-only permission constraint; it does not expand this change to SSO or automatic translation.

Per the user’s updated scope, measure local CMS-only startup, idle, editing, upload/processing and public reads, reporting CPU and memory under explicit container limits. Use MySQL for this measurement and production; SQLite is only the editorial trial. Exclude other application services and VPS capacity validation because the VPS is unavailable. Do not infer whole-host capacity from the local result. Failure of the local CMS check stops adoption and requires a revised choice. Use a dedicated database/user on an existing supported MySQL service only if the pinned version's support is verified; do not upgrade application databases for the trial. One CMS instance needs no dedicated Redis or Kubernetes.

### 2. Keep shared facts separate from translation publication

CMS articles have a UUID, `profileUserId`, cover, stable tag relations and optional game/rating. Translation records are unique by article/locale and contain title, HTML, excerpt, localized image alt text, status and `publishedAt`. Supported locales are `en` and `pt-BR`. Public authorship uses GameNode profiles independently of CMS staff login.

Use database constraints and grant-enabled custom access policies to enforce editorial permissions and filter delivery access to published content. Add a publication hook only for checks configuration cannot express: GameNode author/game validation through existing APIs, review tag/metadata equivalence, complete content/cover descriptions and finite ratings from 0 through 5. Invalid references or unavailable validation prevent publication without discarding the draft. Apply these checks to shared metadata edits affecting published translations. Provide game lookup through the existing API rather than copying the catalog.

### 3. Select a complete translation before pagination

Directus does not expose SQL views through its Items API. NestJS therefore reads the CMS through a server-only, read-only credential and selects the complete published translation itself before filtering, counting, ordering and pagination. It selects the requested locale, then English, or excludes the article; order is selected `publishedAt DESC, articleId ASC`. Public tags use the same eligibility rules. Tests must exercise draft exclusion, fallback, filtering and counts through the public API.

The delivery credential must be read-only and restricted by custom access policies to published translations and their required shared article/tag data. Draft translations must remain inaccessible through direct requests and nested relations, including on articles with another published translation. Keep the credential exclusively on the server and never return it to clients or embed it in asset URLs. Deny unauthenticated raw CMS reads and use a separate restricted preview credential for drafts. Public delivery code must always enforce publication regardless of the caller's roles. Test direct unauthenticated CMS denial, delivery-token draft exclusion and mutation denial, and public API draft exclusion. Reuse existing HTTP facilities with a bounded timeout. CMS errors return 503, absence returns 404 and a successful empty list remains empty. There is one content source.

### 4. Publish one clean DTO and separate preview

Use versioned `GET blog/post`, `GET blog/post/:postId` and `GET blog/post/tags` with validated optional locale, default `en`. Lists accept tag/limit/offset and use the existing pagination envelope. Remove `includeDraft` from the public contract. Tags come only from eligible published articles.

Public DTO: `id`, `title`, sanitized `content`, `excerpt`, `profileUserId`, `tags: {id,name}[]`, nullable `review: {gameId,rating}`, `cover: {url,alt}`, `publishedAt`, `requestedLocale`, `resolvedLocale` and published `availableLocales`. There are no legacy image, draft or persistence fields. Generate OpenAPI from this contract and update all clients to it.

Add `GET blog/preview/:postId?locale=...` protected by existing GameNode auth and ADMIN/MOD/EDITOR roles. Require an exact locale with no fallback; return the presentation data and actual draft state. Preview responses and media are private and no-store. The paired admin preview route fetches them without public query caching or draft SSR hydration.

### 5. Enforce the HTML and media boundary

Sanitize CMS HTML at NestJS delivery, including preview, with a maintained server HTML sanitizer. No existing sanitizer was identified; do not implement one with regular expressions. Permit supported formatting, safe links and responsive images, strip executable markup/URLs and test the allowlist against CMS-authored fixtures. Clients render this safe subset without Tiptap.

CMS originals and draft-only assets stay private. On publication, promote approved assets once into public delivery storage and rewrite delivery references to explicit URLs, with isolated storage permissions. Preview media uses authenticated delivery without CMS tokens in URLs. Already-published media can remain publicly retrievable after article unpublication; document that policy. There is no filename/extension compatibility copy or adapter. Bound uploads and image transformations and avoid repeated transformations on public reads.

### 6. Delete the internal implementation

Remove internal create/update/image/delete handlers, write DTOs, repository-backed logic and unused entities. Remove their module registrations and drop the blog-only join/review/post/image/tag tables in foreign-key-safe order using a new migration; leave historical migrations intact. There are no records to export or retain. Verify both a fresh migration chain and an existing development schema. Shared profile/game data and community uploads must remain intact.

Remove obsolete code rather than repairing its author check or transaction handling. The clients delete their old forms/routes/actions and regenerate the wrapper from the new API. No retirement handlers, feature flags or parallel read sources are needed.

## Risks / Trade-offs

- License/version or resource mismatch → validate the pinned CMS against the intended deployment before adoption.
- CMS markup or media rendering differs from GameNode → test bilingual articles, reviews and image editing/rendering with new fixtures.
- Draft leakage or executable content → enforce CMS policies, separate preview credentials, sanitization and private-media tests.
- Dropping obsolete tables → restrict the migration to blog-owned tables and verify community/profile/game data survives.

## Implementation Plan

1. Run the CMS trial with new test content and record the adoption result.
2. Configure CMS ownership, permissions and delivery; publish the new NestJS OpenAPI contract.
3. Update the paired wrapper and web/mobile/admin callers, then remove internal authoring and storage.
4. Verify the integrated CMS-to-reader flow and document persistent CMS storage, staff access and deployment configuration.
