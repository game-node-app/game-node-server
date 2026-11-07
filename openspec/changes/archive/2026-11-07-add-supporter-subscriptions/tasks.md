# Tasks

## 1. Dependencies and Stripe configuration

- [x] 1.1 Add `@better-auth/stripe@1.7.14` and `stripe@^23` to `package.json`, run `yarn install`, and verify the installed versions and peer dependencies match `better-auth@1.7.14`, `@better-auth/core@1.7.14` and `better-call@1.4.4`.
- [x] 1.2 Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SUPPORTER_MONTHLY` and `STRIPE_PRICE_SUPPORTER_YEARLY` to `.env.example` and `docker-compose.prod.yml` (the local `docker-compose.yml` has no server service; the app reads `.env`); document the Stripe Dashboard setup (product, monthly/annual multi-currency Prices with `tax_behavior: "inclusive"`, webhook endpoint and Customer Portal) in `docs/supporter-subscriptions.md` and verify every documented value and path matches the implementation.
- [x] 1.3 Record the verified Stripe Tax blocker in `docs/supporter-subscriptions.md`: Checkout creation with `automatic_tax` enabled and the Tax registrations/settings/calculations APIs fail with "Stripe Tax is not supported for your account country" for the Brazilian account. Confirm the two Prices keep `tax_behavior: "inclusive"` at the top level and in `currency_options.brl`, and verify a test Checkout Session succeeds without `automatic_tax`.

## 2. Database schema

- [x] 2.1 Create the additive TypeORM migration adding `user.stripeCustomerId` and the `subscription` table with `referenceId`, `stripeSubscriptionId` (unique) and `stripeCustomerId` indexes; verify `up` and `down` against a disposable database and confirm the table has no `limits` column and no foreign key on `referenceId`.

## 3. Auth plugin integration

- [x] 3.1 Configure the Stripe plugin in `AuthService` with the single `supporter` plan, monthly `priceId`, annual `annualDiscountPriceId`, `createCustomerOnSignUp: false`, an `authorizeReference` restricted to the session user, `getCheckoutSessionParams` enabling promotion codes and passing the locale (no `automatic_tax`, per 1.3), lifecycle logging hooks and conditional enablement when the four Stripe environment values are present; verify the app boots with and without Stripe configuration, a test Checkout Session succeeds without automatic tax and the existing auth integration tests still pass.
- [x] 3.2 Expose the Stripe client, an enabled flag and a `getSubscriptions(userId)` lookup from `AuthService` for the billing module; verify the lookup returns all subscription rows for a user and introduces no constructor cycle or module import regression.
- [x] 3.3 Verify the plugin webhook at `/v1/auth/stripe/webhook` with signed webhook requests (the Stripe CLI is unavailable locally): a valid `checkout.session.completed` or `customer.subscription.updated` event updates the local row, an invalid signature is rejected without state change, and a duplicated delivery converges on one row; record the commands and outcomes in `implementation-validation.md`.

## 4. Billing module

- [x] 4.1 Implement `BillingService` with offer resolution (`CF-IPCountry`, `Accept-Language`, USD fallback), `isSupporter`, the `GET /billing/me` projection, checkout creation through the plugin, portal creation, direct cancel/restore and the disabled-Stripe 503 path; verify unit tests cover active, trialing, past-due grace, past-due after grace, canceled-but-paid, incomplete and free states, plus BRL/USD offer selection and the existing-active-subscription guard.
- [x] 4.2 Implement `BillingController` and request/response DTOs for `GET /v1/billing/offers` (public), `POST /v1/billing/checkout`, `GET /v1/billing/me`, `POST /v1/billing/portal`, `POST /v1/billing/cancel` and `POST /v1/billing/restore`; verify controller tests cover 200, 401, 404/409 and 503 responses, reject client-supplied price/amount values and confirm the offers response exposes no Stripe identifiers.
- [x] 4.3 Register `BillingModule` in `AppModule` and regenerate `server_swagger.json`; verify the application boots and the six billing routes appear with their authentication requirements. Do not change profile, collections or feature endpoints in this change.

## 5. Client contract and integrated validation

- [x] 5.1 Write `handoff-clients.md` with the six billing endpoints, request/response shapes, BRL/USD prices, checkout redirect flow, portal/cancel/restore behavior and error codes; verify the examples match the actual DTOs and explicitly state that client UI, supporter badge and feature gating are separate changes.
- [x] 5.2 Run `yarn test:typecheck`, `yarn build` and the affected Jest suites for auth, billing and module registration; verify there are no type, build or regression failures.
- [x] 5.3 Complete a Stripe test-mode smoke test covering monthly BRL, monthly USD, annual BRL and annual USD checkout without automatic tax, webhook synchronization, `GET /billing/me`, cancellation at period end and restoration; record redacted outcomes and any unavailable checks in `implementation-validation.md`.
- [x] 5.4 Document the production deployment order and rollback in `docs/supporter-subscriptions.md`: migration first, secrets and Stripe Dashboard configuration, API deploy, webhook smoke test, and the rule not to drop the `subscription` table while Stripe subscriptions remain active. State that Stripe Tax is not enabled for this account and the seller remains responsible for tax.

## Deferred

- Implement and gate premium features, the supporter badge, the collection limit and the client billing UI in separate changes.
- Review tax registration coverage and filing/remittance operations with an accountant; Stripe Tax is unavailable for this account, so the seller remains liable and no tax is calculated at checkout.
- Add a reconciliation job if webhook drift is observed and a guard that cancels active subscriptions before user deletion.
- Revisit a foreign entity, USD settlement or recurring Pix only if the product requires them.

## Workflow follow-up

- Archive the change after implementation, validation and the project's review requirements are satisfied.
- Verify the archived result and the main `supporter-subscriptions` spec.
