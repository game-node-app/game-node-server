# Spec Delta

## Purpose

Lets each Awards category carry its name and description in every supported locale (`en` and `pt-BR`). Clients can then show category content in the user's language and fall back to the base text when a translation is missing.

## ADDED Requirements

### Requirement: Categories store optional per-locale content
Each Awards category SHALL keep its required base `name` and `description`. In addition, it MAY have at most one translation for each supported locale (`en`, `pt-BR`), and each translation SHALL have a non-empty `name` and `description`. Deleting a category SHALL delete its translations.

#### Scenario: Existing categories after the upgrade
- **WHEN** the change is deployed over existing Awards categories
- **THEN** every existing category keeps its `name` and `description` unchanged and has no translations

#### Scenario: Category with both translations
- **WHEN** an admin saves a category with `en` and `pt-BR` translations
- **THEN** reading the category returns both translations exactly as saved

#### Scenario: Category deleted
- **WHEN** a category with translations is deleted
- **THEN** its translations no longer exist

### Requirement: Admin translation input is validated
The admin create/update category endpoint SHALL accept an optional `translations` array of `{ locale, name, description }`. It SHALL reject the request with HTTP 400 and store nothing in any of these cases:
- an item's `locale` is not `en` or `pt-BR`
- an item's `name` or `description` is missing, empty or not a string
- two items share a locale

#### Scenario: Partial entry rejected
- **WHEN** an admin saves a category with `translations: [{ locale: "en", name: "Best Indie", description: "" }]`
- **THEN** the request fails with HTTP 400 and the stored category is unchanged

#### Scenario: Unsupported locale rejected
- **WHEN** an admin saves a category with a translation whose locale is `es`
- **THEN** the request fails with HTTP 400

#### Scenario: Duplicate locale rejected
- **WHEN** an admin saves a category with two `en` translations
- **THEN** the request fails with HTTP 400

### Requirement: Admin saves replace the translation set
When `translations` is present, saving a category SHALL replace that category's full set of translations with the submitted items in one atomic operation. When `translations` is omitted on update, the stored translations SHALL be left unchanged. An empty array SHALL remove all of them.

#### Scenario: Only one locale provided
- **WHEN** an admin saves a category with only an `en` translation
- **THEN** the save succeeds and reads return only the `en` translation

#### Scenario: Locale removed by omission from the set
- **WHEN** a category has `en` and `pt-BR` translations and an admin saves it with only `pt-BR`
- **THEN** reads return only the `pt-BR` translation

#### Scenario: Update without translations keeps them
- **WHEN** an admin updates a category's `order` without sending `translations`
- **THEN** the previously stored translations are still returned

#### Scenario: Clearing translations
- **WHEN** an admin updates a category with `translations: []`
- **THEN** reads return `translations: []`

### Requirement: Every category read exposes translations
Every API response that includes an Awards category SHALL include its `translations` as an array of `{ locale, name, description }`, or an empty array when it has none. This covers the event categories list, the `category` embedded in category results, and each category in the user ballot. The server SHALL NOT select or substitute text by locale, and the base `name` and `description` SHALL always be returned as stored.

#### Scenario: Categories list includes translations
- **WHEN** a client requests the categories of an Awards event
- **THEN** each category in the response contains `name`, `description` and `translations`

#### Scenario: Ballot includes translations
- **WHEN** an authenticated user requests their ballot for an event
- **THEN** each ballot category contains `translations` next to its base `name` and `description`

#### Scenario: Results include translations
- **WHEN** a client requests the category results of an event
- **THEN** each result's `category` contains `translations`

### Requirement: Clients resolve content with a base-text fallback
The API contract SHALL guarantee that a client can display a category in the user's locale by taking the translation whose `locale` matches. When there is no such translation, the client uses the base `name` and `description`. The OpenAPI schema SHALL describe `translations` as an array of objects with a `locale` enum (`en`, `pt-BR`) and string `name` and `description`, all required.

#### Scenario: Missing locale falls back
- **WHEN** a category has only a `pt-BR` translation and the client locale is `en`
- **THEN** the response still contains the base `name` and `description`, which the client displays

#### Scenario: Typed schema
- **WHEN** the OpenAPI document is generated
- **THEN** the `translations` property of category schemas is an array whose items reference a schema with required `locale` (enum `en`, `pt-BR`), `name` and `description`
