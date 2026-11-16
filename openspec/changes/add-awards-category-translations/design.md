# Design

## Context

`AwardsCategory` has required `name` and `description` columns that admins fill in once. Categories are read in four places:
- `AwardsService.getCategoriesByEventId`: the categories list. It loads `relations: { suggestions: true }` and returns `VotableAwardsCategoryDto = OmitType(AwardsCategory, ["event"])`.
- `awards-result.service.ts`: the results. It loads `relations: { category: true }`.
- `awards-ballot.service.ts`: the ballot. It maps entities into `AwardsBallotCategoryDto`.
- The admin detail view.

Some of these reads are cached for 10 minutes by `@Cacheable`, and the cache keys do not include a locale. The blog supports `en | pt-BR` by selecting on the server through `?locale=`.

## Goals / Non-Goals

**Goals:**
- A normalized table where the database enforces one translation per category and locale.
- An additive field on every category read, with no new endpoints or parameters.
- A typed OpenAPI schema for the generated clients.
- No backfill required, since existing data keeps working through the base text.

**Non-Goals:**
- Choosing the locale on the server (`Accept-Language` or `?locale=`).
- Translating other Awards text: event metadata, notifications or errors.
- Moving the base `name`/`description` into the translation table. That would be a breaking contract change and a data migration with no product benefit now.
- Adding locales beyond `en` and `pt-BR`. A new locale only means a new enum value.

## Decisions

### 1. Child table `awards_category_translation`
This is a new entity `AwardsCategoryTranslation` that extends `BaseEntity`:

| Field | Definition |
|---|---|
| `id` | PK |
| `category` | `@ManyToOne(() => AwardsCategory, { onDelete: "CASCADE" })` |
| `categoryId` | not null |
| `locale` | `varchar(8)`, typed as `AwardsCategoryLocale = "en" \| "pt-BR"` |
| `name` | varchar, not null |
| `description` | text, not null |

The table has `@Unique(["categoryId", "locale"])`. `AwardsCategory` gets `@OneToMany(() => AwardsCategoryTranslation, (t) => t.category) translations`.

*Alternatives considered:*
- A JSON column on `awards_category`. It is simpler, but the database could not enforce uniqueness or structure, and translation coverage could not be queried.
- Per-locale columns. These widen the table every time a locale is added.

### 2. Keep `name` / `description` as the required base text
The base text is what older clients use, and what any missing locale falls back to. It stays not null, so the current wrapper types and clients keep working.

### 3. Return the whole set; clients choose
Every read loads `translations`:
- the categories list: `relations: { suggestions: true, translations: true }`
- the results: `relations: { category: { translations: true } }`
- the ballot: the category query gets the same relation, and the DTO maps it

Locale selection stays on the client, like the UI strings. This means there is no `?locale=` on four endpoints and no locale dimension in the `@Cacheable` keys. The payload cost is a few hundred bytes per category.

*Alternative:* the blog pattern of server-side `?locale=`. It was rejected because of the cache keys, and because the ballot joins two queries on the client that would both need the same locale.

### 4. Response shape and Swagger
`translations` is serialized as `AwardsCategoryTranslationDto[]`, where each item is `{ locale, name, description }`. Internal columns (`id`, `categoryId`, timestamps) are not part of the contract:
- Ballot: an explicit mapping in the ballot service.
- Categories list and results: currently return entities. Annotate the entity relation with `@ApiProperty({ type: [AwardsCategoryTranslationDto] })`, then either strip the item fields with a small mapper in each service, or accept the extra entity fields in the response. The implementer picks whichever keeps the Swagger type accurate. The extra fields would be harmless, but the schema must reference `AwardsCategoryTranslationDto`.

`AwardsCategoryTranslationDto` uses `@ApiProperty({ enum: ["en", "pt-BR"] }) locale`, plus `name` and `description` as required strings.

### 5. Validation
`CreateUpdateAwardsCategoryDto.translations?: AwardsCategoryTranslationInputDto[]` is validated with `@IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(...)`. Each item uses:
- `@IsIn(["en", "pt-BR"])` on `locale`
- `@IsString() @IsNotEmpty()` on `name` and `description`

Duplicate locales are checked in the service, or with a custom array validator, and rejected with HTTP 400. The unique index is the last line of defense.

### 6. Replace-the-set in a transaction
`createOrUpdateAwardsCategory` runs inside `dataSource.transaction`:
1. Save the category.
2. If `dto.translations !== undefined`, delete the category's translations, then insert the submitted ones.

Delete-then-insert avoids upsert edge cases on the unique index, and the set is at most two rows. If the request omits `translations` on update, the existing rows are not touched.

### 7. Server-side text stays on the base
The vote-service error message that uses `category.name`, and any notification copy, keep the base text. Server errors are not localized.

## Risks / Trade-offs

- **[Risk]** An extra join on every category read. → There are at most two rows per category over a handful of categories, so the join is negligible. The reads are also cached.
- **[Risk]** Cached payloads hide an admin edit for up to 10 minutes. → This is the same as base-text edits today, so it is acceptable.
- **[Risk]** Entity serialization leaks `id`, `categoryId` and timestamps into the categories and results responses. → The Swagger type is the DTO, so clients only rely on `locale`, `name` and `description`. Map the items if a clean payload is wanted.
- **[Risk]** A partial failure while replacing the set. → It runs in one transaction.

## Migration Plan

1. Create migration `<timestamp>-AddAwardsCategoryTranslations`:
   - **Up:** create `awards_category_translation` with the PK, `categoryId` (FK to `awards_category.id` `ON DELETE CASCADE`), `locale`, `name`, `description`, timestamps from `BaseEntity`, and the unique index `(categoryId, locale)`.
   - **Down:** drop the table.
2. Deploy the server before the clients. The field is additive, so old clients ignore it.
3. Fill in the 2026 category translations through the updated admin form (clients change), or with a one-off insert, before voting opens.
4. Rollback: revert the deploy and run the down migration. The base text is untouched, so clients fall back automatically.
