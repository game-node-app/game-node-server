## Purpose

Give editors one CMS for writing and localized publication, with validated references and no internal blog authoring system.

## ADDED Requirements

### Requirement: Evidence before CMS adoption
CMS adoption SHALL require recorded license eligibility for the pinned version, supported database configuration, writer acceptance, successful HTML edit/save/render checks and measured local CMS-only CPU and memory use with MySQL under explicit container limits. A failed check MUST stop adoption.

#### Scenario: Grant activation
- **WHEN** the acquired Open Innovation Grant license is configured on pinned Directus 12.6.0
- **THEN** activation and custom access policy availability are verified and recorded without exposing the license key before adopting grant-dependent permissions

#### Scenario: Local CMS resource limit is exceeded
- **WHEN** the local CMS trial causes OOM events or breaches its recorded container resource limits
- **THEN** the CMS is not adopted and the failed trial result is recorded

### Requirement: Shared identity and independent translations
Articles SHALL have a UUID, GameNode author identifier, cover, stable tags and optional game/rating. Translations SHALL be unique by article and supported locale, with title, HTML, excerpt, localized alt text, independent publication state and publication timestamp. CMS login identity MUST NOT replace public authorship.

#### Scenario: Publish one language
- **WHEN** an editor publishes English while Portuguese remains in draft
- **THEN** English is publicly eligible and Portuguese remains unavailable to public delivery

### Requirement: Validated publication
Publication SHALL require complete translation content, cover and accessible image descriptions, valid GameNode author/game references, and consistent `review` tag plus game/rating metadata. Ratings SHALL be finite values from 0 through 5. Invalid or unverified references MUST prevent publication without discarding the draft.

#### Scenario: Invalid game review
- **WHEN** an editor attempts publication with an unknown game, an out-of-range rating or a `review` tag without review facts
- **THEN** publication fails with an actionable validation error and draft work is preserved

#### Scenario: Reference service unavailable
- **WHEN** GameNode cannot validate an author or game during publication
- **THEN** publication fails closed and the draft remains editable

### Requirement: Editorial and infrastructure isolation
Staff SHALL use dedicated editorial accounts. Delivery SHALL use a server-only read-only credential with grant-enabled policies allowing published translations and required shared data; preview SHALL use separate restricted draft credentials. Public APIs MUST enforce publication regardless of caller roles. CMS infrastructure SHALL use isolated credentials, persistent storage and bounded processing. License keys and CMS credentials MUST remain server-side secrets.

#### Scenario: Isolated persistent infrastructure
- **WHEN** the CMS is deployed or restarted
- **THEN** content and assets persist, database/storage credentials cannot access application tables or community upload writes, and uploads, revisions and processing remain bounded

#### Scenario: Delivery credential misuse
- **WHEN** an anonymous caller requests raw CMS content or public delivery requests a draft
- **THEN** CMS permissions deny anonymous access and the public API excludes drafts; the server-only delivery credential cannot mutate content

#### Scenario: Delivery credential cannot read drafts
- **WHEN** the delivery credential requests an article with published English and draft Portuguese, directly or through nested relations
- **THEN** only the published translation is accessible, while draft Portuguese is available only through authorized preview access

### Requirement: Recoverable editorial workflow
The CMS SHALL let a writer recover a saved prior revision, manage images and edit linked English/Portuguese translations without publishing either language unintentionally.

#### Scenario: Recover an accidental edit
- **WHEN** a writer saves an incorrect body and selects an earlier retained revision
- **THEN** the previous content can be restored as a draft without changing the other translation's publication state

### Requirement: Sole CMS authoring
The CMS SHALL be the only blog authoring system. Internal blog create/update/image/delete operations and application-owned blog persistence SHALL be removed. Community-post authoring and shared GameNode profile/game records MUST remain functional.

#### Scenario: Completed replacement
- **WHEN** the CMS-backed blog is available
- **THEN** articles are authored only in the CMS, internal blog write operations/tables are absent, and community/profile/game features still function
