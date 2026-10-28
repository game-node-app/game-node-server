# Tasks

Paired initiative: [clients tasks](../../../../game-node-clients/openspec/changes/migrate-blog-to-cms/tasks.md). The project has no live users or blog data. Replace the internal system directly; each repository applies its own implementation.

## 1. CMS trial and adoption checks

- [x] 1.1 Record the pinned Directus version, official license eligibility and database support; verify the chosen license and configuration permit the intended deployment.
- [x] 1.2 Add isolated trial Compose/config with persistent SQLite/assets and separate storage credentials; verify restart persistence and denial of anonymous draft/media access.
- [x] 1.3 Create new English/Portuguese articles, images and a review; have a writer exercise independent publication, image editing and revision recovery, and record observed acceptance and HTML edit/save/render results.
- [x] 1.4 Measure local CMS-only startup/idle/edit/upload/public-read CPU and memory with MySQL; record the container limits, workload and results. Per user direction, exclude other application services and VPS capacity validation.
- [x] 1.5 Verify the acquired Open Innovation Grant license activates on pinned Directus 12.6.0 and enables custom access policies; record the result without exposing the key. Preserve completed Core trial results as historical evidence.

## 2. CMS ownership, publication and media

- [x] 2.1 Commit repeatable CMS model and grant-enabled custom access policies for article UUIDs, unique article/locale translations, tags and independent publication; verify duplicate translations are rejected and one language can remain private.
- [x] 2.2 Add publication/reference validation and existing-API game lookup configuration; test author/game validity, review tag consistency, finite 0–5 ratings and unavailable reference APIs, including shared metadata edits, without losing draft work.
- [x] 2.3 Implement server-side localized published-content selection from the CMS; integration-test requested/fallback/neither selection, tag filtering, count-before-pagination and stable date/UUID ordering.
- [x] 2.4 Configure separate server-only read-only delivery and restricted preview credentials using custom access policies; verify anonymous CMS requests cannot read raw content, delivery credentials cannot read draft translations directly or through nested relations or mutate records, and authorized preview can read drafts. Include an article with published English and draft Portuguese; document staff provisioning and secret configuration.
- [x] 2.5 Implement private draft assets and publication-time public delivery with explicit URLs and isolated storage permissions; verify anonymous draft-media denial and usable cover/inline references, and document already-published media visibility.

## 3. NestJS delivery and preview

- [x] 3.1 Implement clean public article DTOs and locale/tag/pagination reads using the CMS; controller/service tests verify en/pt-BR, omitted/invalid locale, tag visibility, complete fallback and game/author facts.
- [x] 3.2 Add maintained server HTML sanitization based on CMS-authored fixtures; test script/handler/unsafe URL removal and supported text/link/image rendering in public and preview responses.
- [x] 3.3 Add exact-locale staff preview using existing auth/roles and private no-store delivery; HTTP-test anonymous/non-editorial denial and published-only public reads even for editorial users.
- [x] 3.4 Use existing HTTP facilities with bounded timeouts and explicit 503/404/empty-list behavior; test upstream failure without substituting another content source.
- [ ] 3.5 Export actual OpenAPI and document the public/preview contract; verify the paired regenerated wrapper fetches a localized web/mobile detail with safe media and SSR output.

## 4. Remove internal authoring and persistence

- [x] 4.1 Delete internal create/update/image/delete handlers, write DTOs and repository-backed authoring logic; verify those operations are absent from OpenAPI and the server builds with the CMS implementation only.
- [x] 4.2 Remove obsolete blog entities/registrations and add a foreign-key-safe migration dropping only blog-owned join/review/post/image/tag tables; test a fresh migration chain and an existing development schema while preserving profile/game/community data.
- [x] 4.3 Add adopted deployment/environment documentation for persistent CMS storage, health checks, restricted credentials and bounded uploads/revisions/transforms; validate Compose and exercise documented startup with new test content.

## 5. Integrated acceptance

- [ ] 5.1 Verify the paired server/web/mobile/admin result with newly authored bilingual content: fallback, tag/page counts, UUID navigation, SSR/SEO, preview/media isolation, safe HTML and CMS errors; record results with focused tests and relevant builds passing.
