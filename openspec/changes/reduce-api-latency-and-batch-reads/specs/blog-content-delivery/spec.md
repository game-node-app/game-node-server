# Spec Delta

## ADDED Requirements

### Requirement: Public blog reads use bounded presentation caching
Public blog list, detail, and tag endpoints SHALL reuse bounded cached representations of published CMS content and sanitized, media-verified presentation outputs. Cache errors SHALL fall back to live loading, cold CMS or media failures SHALL continue returning HTTP 503, and staff draft previews MUST remain uncached with `Cache-Control: private, no-store`.

#### Scenario: Repeated public blog list reads reuse cached presentation output
- **WHEN** two public callers request `GET /v1/blog/post` with identical locale, tag, limit, and offset within the cache TTL
- **THEN** the second request serves the cached sanitized response without querying Directus, re-running HTML sanitization, or calling filesystem media checks

#### Scenario: Draft preview bypasses all blog caches
- **WHEN** an authorized editor requests a draft translation through the preview endpoint while public caches are warm
- **THEN** the preview fetches live CMS content, skips public caches, and responds with `Cache-Control: private, no-store`

#### Scenario: Cold CMS outage still returns 503
- **WHEN** the public blog cache is empty and Directus is unreachable
- **THEN** public blog reads return HTTP 503 without caching the failure
