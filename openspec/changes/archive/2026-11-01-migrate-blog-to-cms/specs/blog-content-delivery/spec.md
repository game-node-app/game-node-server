## Purpose

Deliver localized published blog articles through GameNode while keeping editorial credentials and unpublished content private.

## ADDED Requirements

### Requirement: Whole published translation selection
Public list and detail reads SHALL accept only `en` and `pt-BR`, default omitted locale to `en`, select the requested published translation or a complete published English fallback, and return `requestedLocale`, `resolvedLocale` and published `availableLocales`. Fields MUST NOT be mixed between translations.

#### Scenario: Portuguese draft with English publication
- **WHEN** a reader requests `pt-BR` for an article whose Portuguese translation is a draft and English translation is published
- **THEN** only English content is returned with `requestedLocale=pt-BR`, `resolvedLocale=en` and `availableLocales=[en]`

#### Scenario: No eligible translation
- **WHEN** neither the requested translation nor an English fallback is published
- **THEN** detail returns 404 and lists omit the article, even for signed-in editorial staff

#### Scenario: Invalid or omitted locale
- **WHEN** a read supplies an unsupported locale or omits locale
- **THEN** unsupported values receive 400 and omission selects English

### Requirement: Article-level pagination and tag visibility
Lists SHALL apply publication, locale selection and stable tag filters before counting and pagination, return one entry per article, and use descending selected publication date with a stable UUID tie-breaker. Public tag discovery MUST expose only tags attached to eligible published articles.

#### Scenario: Two translations and a hidden article
- **WHEN** a tagged list contains an article published in both languages and another with no eligible published translation
- **THEN** the first counts once, the second counts zero and page totals match eligible articles

#### Scenario: Draft-only tag
- **WHEN** a tag exists only on articles with no eligible publication for the requested locale
- **THEN** public tag discovery omits that tag

### Requirement: Article presentation contract
Public reads SHALL supply article UUID, localized title, sanitized HTML, excerpt, GameNode author identity, stable tags, shared game/rating facts when present, selected publication date, cover URL/alt text and locale metadata. Clients MUST NOT need CMS persistence records or constructed asset paths.

#### Scenario: Published review
- **WHEN** a reader opens a CMS-authored review in either locale
- **THEN** the selected localized content has the same author, game and rating alongside usable media URLs

### Requirement: Safe HTML and media boundary
Delivered HTML SHALL remove executable markup and unsafe URL schemes while preserving supported formatting, safe links, images and alt text. CMS credentials MUST NOT appear in public content or URLs. Unpublished assets SHALL require staff access; already-published assets SHALL have a documented public visibility policy.

#### Scenario: Malicious markup
- **WHEN** content contains scripts, event handlers or executable link/image URLs
- **THEN** public and preview responses remove unsafe content while preserving supported paragraphs, headings, lists, links and images

#### Scenario: Draft media access
- **WHEN** an anonymous reader requests an asset used only by an unpublished translation
- **THEN** access is denied without exposing a CMS token or reusable private asset URL

### Requirement: Preview isolation
Draft preview SHALL use a separate authenticated staff-only path with `Cache-Control: private, no-store`. Public reads MUST never include drafts and MUST NOT provide a draft-inclusion option.

#### Scenario: Public read by editorial staff
- **WHEN** an editorial user requests an article through the public API
- **THEN** only the published selection is eligible, regardless of that user's staff privileges

#### Scenario: Staff preview
- **WHEN** authorized editorial staff request a specific translation through preview
- **THEN** that translation and its draft state are returned without public fallback, while anonymous or non-editorial users receive 401 or 403

### Requirement: Explicit upstream failures
CMS failures SHALL return 503 rather than masquerading as missing content or an empty archive. Genuine missing eligible content SHALL return 404 on detail and be omitted from successful lists.

#### Scenario: CMS unavailable
- **WHEN** the CMS cannot answer a public article request
- **THEN** GameNode returns a service error without substituting another content source
