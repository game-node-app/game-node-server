# Proposal

## Why

GameNode's internal editorial system lacks article localization and revision recovery. Following the clients repository's `docs/blog-redesign-investigation.md`, use a self-hosted CMS for writing while keeping GameNode's public blog, profiles and games. The project is not live, has no current users and has no blog data to preserve; these confirmed facts supersede the report's migration assumptions.

## What Changes

- Trial Directus first; verify licensing, database support, writer acceptance, HTML rendering and resource fit before adoption. A failed trial stops adoption rather than introducing another editorial backend.
- Model article UUIDs, GameNode author references, covers, tags and optional game reviews with independently published `en`/`pt-BR` translations.
- Deliver published content through NestJS with validated locale, complete English fallback, article-level pagination, explicit media URLs, sanitized HTML and authenticated staff preview.
- **BREAKING:** replace internal blog persistence and write/image/delete endpoints outright. Remove obsolete DTOs, entities and tables; all clients consume the new contract together.

## Capabilities

### New Capabilities

- `blog-content-delivery`: localized published article reads, fallback, draft isolation, safe HTML/media and preview.
- `blog-editorial-ownership`: CMS authoring, adoption checks, publication validation and removal of internal authoring.

### Modified Capabilities

None. Existing server specifications do not cover the blog.

## Impact

- `src/blog/blog-post`: controller, service, DTOs and module; remove internal blog entities and add a table-removal migration. Reuse existing HTTP/config facilities and add focused delivery/publication tests.
- One pinned CMS service with isolated persistent database/storage, staff accounts and restricted delivery credentials; deployment and environment documentation live here. The owner has acquired an Open Innovation Grant license, enabling custom access policies; verify activation on the pinned version and use filtered delivery permissions.
- Counterpart: [clients proposal](../../../../game-node-clients/openspec/changes/migrate-blog-to-cms/proposal.md). Server owns the CMS and delivery contract; clients owns the generated wrapper, readers, SSR/SEO and CMS navigation.
- No compatibility adapters, data import/export, rollout machinery, cache upgrades or repairs to the deleted editorial implementation. Community content remains outside this change.
