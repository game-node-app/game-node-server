# Tasks

## 1. Data model

- [x] 1.1 Add `AwardsCategoryTranslation` (`src/awards/entity/awards-category-translation.entity.ts`), as described in design decision 1. Add the `translations` one-to-many relation on `AwardsCategory` and register the entity in `awards.module.ts`. Verify: `pnpm test:typecheck` passes.
- [x] 1.2 Add `AwardsCategoryTranslationDto` (response type: `locale` enum, `name`, `description`) and `AwardsCategoryTranslationInputDto` (class-validator rules from design decision 5) under `src/awards/dto/`. Annotate the entity relation's `@ApiProperty` with the response DTO. Verify: typecheck passes.
- [x] 1.3 Create migration `src/migrations/<ts>-AddAwardsCategoryTranslations.ts`, with a timestamp later than `1795300000000`. It creates the table, the cascading FK and the unique `(categoryId, locale)` index. Verify:
  - `pnpm migration:run` succeeds on the local DB
  - a duplicate `(categoryId, locale)` insert fails
  - deleting a category removes its rows
  - the down migration drops the table

## 2. Admin writes

- [x] 2.1 Add optional `translations: AwardsCategoryTranslationInputDto[]` to `CreateUpdateAwardsCategoryDto`, and reject duplicate locales with HTTP 400. Verify: tests cover the 400 cases from the spec (empty description, `es` locale, duplicate `en`).
- [x] 2.2 Wrap `createOrUpdateAwardsCategory` in a transaction. Save the category, then, only when `dto.translations !== undefined`, delete its translations and insert the submitted ones. Verify: tests in `awards-admin.service.spec.ts` (or an integration spec) show that:
  - saving with only `pt-BR` removes an existing `en`
  - omitting `translations` keeps them
  - `[]` clears them

## 3. Reads

- [x] 3.1 Categories list: load `translations` in `getCategoriesByEventId` and expose it as `AwardsCategoryTranslationDto[]`. Verify: an assertion in `awards-events.integration.spec.ts` that saved translations are returned, and `[]` when there are none.
- [x] 3.2 Results: load `category.translations` in `awards-result.service.ts`. Verify: an assertion in `awards-result.integration.spec.ts` on a result's `category.translations`.
- [x] 3.3 Ballot: add `translations: AwardsCategoryTranslationDto[]` to `AwardsBallotCategoryDto`, load the relation and map it in `awards-ballot.service.ts`. Verify: an assertion in `awards-ballot.integration.spec.ts`, with translations present and with `[]`.

## 4. Contract and checks

- [x] 4.1 Start the server so that it rewrites `server_swagger.json`. Verify: the `translations` property of the category schemas (`AwardsCategory`, `VotableAwardsCategoryDto`, `AwardsBallotCategoryDto`) is an array of `AwardsCategoryTranslationDto`, with required `locale` (enum `en`, `pt-BR`), `name` and `description`.
- [ ] 4.2 Run `pnpm test:typecheck`, `pnpm lint` and `pnpm test --testPathPatterns=awards`. Verify: all pass.
- [x] 4.3 Hand the updated `server_swagger.json` to the clients change `localize-awards-category-content` by copying it to `packages/wrapper/input/server_swagger.json` there. Verify: running `pnpm wrapper:generate` in clients produces `AwardsCategoryTranslationDto.ts`.
