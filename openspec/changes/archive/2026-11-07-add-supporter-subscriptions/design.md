# Design

## Context

See `proposal.md` for motivation and scope.

Current state that shapes the approach:

- `AuthService` owns a single in-process `better-auth@1.7.14` instance with `admin`, `bearer`, `capacitor`, `jwt`, `mcp` and `cimd` plugins. It is mounted at `/v1/auth` by `mountAuth` before Nest's JSON parser, so Better Auth endpoints can read the raw request body.
- The `user` table has `role`, `banned`, `banReason` and `banExpires`; it has no billing columns. `Profile` has no supporter state. There is no billing module, no Stripe/Mercado Pago dependency and no Patreon server integration.
- `main.ts` creates the Nest app with `bodyParser: false`, mounts Better Auth, then installs `json()`/`urlencoded()`. A Stripe webhook under `/v1/auth/*splat` therefore receives the raw body it needs.
- The project uses explicit TypeORM migrations with `synchronize: false`. Better Auth tables were created by migration `1793700000000-ReplaceSupertokensWithBetterAuth`.
- The Cloudflare zone for `gamenode.app` is active. `CF-IPCountry` is available when the API record is proxied; it is a display hint, not an authorization boundary.
- A Brazilian Stripe account supports card subscriptions and one-time Pix. Pix Automático is not available for Brazilian accounts. The account settles in BRL even when a price is presented in USD.
- Stripe Tax is not available for a Stripe account based in Brazil: checkout creation with `automatic_tax` enabled, tax registrations and tax calculations all fail with "Stripe Tax is not supported for your account country". The advertised BRL/USD prices are therefore the final customer-facing total and no tax is calculated or collected by Stripe. Stripe is not a merchant of record; the seller remains responsible for tax registration, filing and remittance.
- `@better-auth/stripe@1.7.14` matches the installed `better-auth@1.7.14`, `@better-auth/core@1.7.14` and `better-call@1.4.4`. Its peer range accepts `stripe@^18` through `^23`.

## Goals / Non-Goals

**Goals:**

- Make Stripe the single source of truth for supporter subscription state and entitlement.
- Sell one supporter plan monthly or annually, with explicit BRL and USD prices that are the final customer-facing total.
- Keep the subscription engine inside Better Auth while exposing a stable server API for all clients.
- Keep the change additive and independently deployable.

**Non-Goals:**

- Implementing or gating premium features, the supporter badge, the collection limit or any client UI. Those are follow-up changes.
- Patreon migration or integration. There are no active patrons.
- Mercado Pago, recurring Pix, tax registration/filing operations, tax advisory or foreign-entity/USD settlement.
- Admin billing screens, invoices, refunds, coupons or dunning customization.

## Decisions

### D1. Better Auth Stripe plugin is the engine; a thin billing module is the API

Use `@better-auth/stripe` for Stripe Customer creation, Checkout Session creation, webhook verification and processing, the `subscription` table and lifecycle state. Add `BillingModule` for the GameNode contract: offers, checkout, entitlement, portal and cancel/restore.

Rationale: the plugin already implements the parts that are easy to get wrong (signature verification, checkout metadata, subscription status mapping, customer lookup, duplicate-subscription guard). The wrapper keeps price IDs, plan selection and error semantics out of three separate clients.

Alternatives considered:

- **Client calls `authClient.subscription.*` directly.** Less server code, but each web/mobile/desktop client would carry plan names, success/cancel URLs and error handling, and the server could not choose the plan or enforce a single checkout policy.
- **Hand-written Stripe integration.** Full control, but duplicates the plugin's webhook, status and customer logic for no product gain.

### D2. One plan, two intervals, multi-currency Prices

Define a single plan named `supporter` with:

- Monthly Price: default USD 1.90, `currency_options.brl.unit_amount = 990` (R$ 9.90).
- Annual Price: default USD 19.00, `currency_options.brl.unit_amount = 9900` (R$ 99.00).

The plugin's `priceId` points to the monthly Price and `annualDiscountPriceId` to the annual Price. The `subscription.plan` value stays `supporter`; `billingInterval` distinguishes `month` from `year`.

Stripe Checkout localizes a multi-currency Price to the customer's local currency when that currency is present, and falls back to the default otherwise. With USD as default, Brazilian customers see BRL and customers in EUR/GBP/other currencies see USD.

`GET /v1/billing/offers` uses `CF-IPCountry` (falling back to `Accept-Language`, then USD) only to choose the displayed amount. The checkout amount is never accepted from the client; the server selects the plan and interval, and Stripe selects the currency.

Alternatives considered:

- **Two plans (`supporter-br`, `supporter-intl`).** Explicit currency in the stored plan, but requires a plan-switch flow, four Price IDs and duplicated plan config. Rejected because the multi-currency Price expresses the same product.
- **Automatic conversion from a BRL price.** Unpredictable customer-facing amounts and worse authorization. Rejected.

### D3. Plugin configuration

- `createCustomerOnSignUp: false`. Create the Stripe Customer on the first checkout. This avoids sending every free user's name and email to Stripe and avoids an empty customer list.
- `authorizeReference: ({ user, referenceId }) => referenceId === user.id`. Prevent a user from managing another user's subscription by passing a different reference.
- Do not configure `limits` in the plan. The 1.7.14 bundled schema does not declare a `limits` column, while the plugin writes `plan.limits` when it is set. Entitlement and future gates live in `BillingService`.
- `getCheckoutSessionParams` enables promotion codes and passes the requested locale. It does not enable Stripe Tax (see D10).
- Lifecycle hooks log subscription completion, updates, cancellation and deletion. No email or notification is sent in this change.
- The plugin is enabled only when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SUPPORTER_MONTHLY` and `STRIPE_PRICE_SUPPORTER_YEARLY` are present. Production requires all four; local development and CI can boot without Stripe, and billing endpoints return 503. This keeps the existing auth integration tests independent of Stripe.
- `AuthService` creates and owns the `Stripe` client (API version matching `stripe@23`) and exposes it, plus `stripeEnabled`, to `BillingService`.

### D4. Schema and migration

Add one additive migration:

- `user.stripeCustomerId varchar(255) NULL`, indexed.
- `subscription` table with the plugin's fields: `id` (varchar 36, UUID), `plan`, `referenceId`, `stripeCustomerId`, `stripeSubscriptionId`, `status`, `periodStart`, `periodEnd`, `trialStart`, `trialEnd`, `cancelAtPeriodEnd`, `cancelAt`, `canceledAt`, `endedAt`, `seats`, `billingInterval`, `stripeScheduleId`, `createdAt`, `updatedAt`.
- Index on `referenceId`, index on `stripeCustomerId`, unique index on `stripeSubscriptionId`.
- No foreign key on `referenceId`: the plugin declares it as a string (varchar 255) while `user.id` is varchar 36. A foreign key would require changing one side. The index plus explicit cancellation on user deletion is the trade-off.
- No `limits` column.

`down` drops the table and the column. In production, rollback should first stop new checkouts and cancel or reconcile active Stripe subscriptions; dropping the table alone would lose the local entitlement record while Stripe keeps charging.

### D5. Entitlement

`BillingService.isSupporter(userId)` reads all `subscription` rows for the user through the Better Auth adapter, the same way `AuthService.getLockoutStates` reads users. No new TypeORM entity is needed.

A row grants entitlement when:

- `status` is `active` or `trialing`; or
- `status` is `past_due` and `periodEnd + 3 days > now`; or
- `status` is `canceled` and `periodEnd > now` (safety for a cancellation recorded before the paid period ends).

`incomplete`, `incomplete_expired`, `unpaid`, `paused` and missing rows do not grant entitlement.

`GET /v1/billing/me` returns the best row for the user (active/trialing first, then past_due, then the most recently updated) with `isSupporter`, `status`, `plan`, `billingInterval`, `periodEnd` and `cancelAtPeriodEnd`. It does not return the amount or currency because the plugin's table does not store them; the Stripe portal shows the invoice and amount.

No cache is added: the query is indexed and small, and a stale cache would delay a cancellation or a recovery from `past_due`.

### D6. Checkout, portal, cancel and restore

- `POST /v1/billing/checkout` requires a session and accepts only `interval: "monthly" | "yearly"` and an optional `locale`. It calls `auth.api.upgradeSubscription` with `plan: "supporter"`, `annual`, server-owned success/cancel/return URLs and `disableRedirect: true`, then returns `{ url }`. The client navigates to the URL.
- If the user already has an active or trialing subscription, checkout returns 409 with the management action instead of creating a second subscription. The plugin itself supports only one active/trialing subscription per reference, but the wrapper makes the behavior explicit.
- `POST /v1/billing/portal` calls `auth.api.createBillingPortal` with `disableRedirect: true` and returns the Stripe Customer Portal URL. A user without a Stripe customer or subscription gets 404/409.
- `POST /v1/billing/cancel` uses the Stripe SDK directly to set `cancel_at_period_end: true` on the active subscription. This keeps the "cancel in the app" promise; the plugin's cancel endpoint opens the portal for confirmation. The plugin webhook updates the local row.
- `POST /v1/billing/restore` clears `cancel_at_period_end` the same way. It is valid only while the subscription is still active and has a pending cancellation.

Alternatives considered:

- **Use the plugin's cancel endpoint.** It redirects to the portal, which is not "in-app" and adds a second confirmation step. The portal remains the place to update cards and view invoices.
- **Cancel immediately.** Rejected; benefits must last until the end of the paid period.

### D7. Webhook and synchronization

The plugin exposes `POST /v1/auth/stripe/webhook` under the existing auth mount. It verifies `Stripe-Signature`, reads the raw body and processes:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The plugin updates `subscription` by `stripeSubscriptionId` and by the metadata written at checkout. `stripeSubscriptionId` is unique, so duplicate deliveries converge. Invalid signatures return 400 and do not change state. Processing errors return non-2xx so Stripe retries.

Out-of-order deliveries are accepted as a residual risk: the plugin applies the event's subscription snapshot rather than re-fetching the latest object. Stripe generally delivers in order and retries failures; a reconciliation job is a follow-up if drift is observed.

### D8. Security

- Checkout, portal, cancel and restore require a session; only the owner's `referenceId` is accepted.
- The client never supplies a Price ID, amount or currency for the charge.
- Stripe secret key and webhook secret stay server-side. `GET /billing/offers` exposes only display amounts and currency.
- The webhook endpoint is public by design but signature-verified; it must bypass Cloudflare Access challenges.
- The existing global throttler applies to billing routes; checkout is the sensitive one and should keep the standard rate limit.

### D9. Operations

- Environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SUPPORTER_MONTHLY`, `STRIPE_PRICE_SUPPORTER_YEARLY`. Add them to `.env.example`, `docker-compose.yml` and `docker-compose.prod.yml`.
- Stripe Dashboard: one product (`GameNode Supporter`), two multi-currency Prices, a webhook endpoint pointing to `https://server.gamenode.app/v1/auth/stripe/webhook` with the four events, and an activated Customer Portal.
- Local testing: sign a webhook payload with `STRIPE_WEBHOOK_SECRET` and POST it to `http://localhost:5000/v1/auth/stripe/webhook`; test cards for success/decline. Do not enable `automatic_tax` in local or production checkout.
- Production deploy order: run the migration, add secrets, configure Stripe (product and Prices), deploy the API, smoke test, then enable the client call-to-action in the separate client change.

### D10. Stripe Tax is not enabled

Stripe Tax cannot be used with the account's country (Brazil). Verified during implementation:

- `checkout.sessions.create` with `automatic_tax: { enabled: true }` fails with "Stripe Tax is not supported for your account country".
- `tax/registrations`, `tax/settings` and `tax/calculations` fail with "Stripe Tax isn't yet supported for your country".

Decision: do not enable `automatic_tax`, do not require a billing address for tax and do not collect a tax ID at checkout. The advertised R$ 9.90 / US$ 1.90 monthly and R$ 99.00 / US$ 19.00 annual are the final customer-facing totals; Stripe does not calculate or collect tax. The seller remains responsible for tax registration, filing and remittance.

The two Prices keep `tax_behavior: "inclusive"` (top level and `currency_options.brl`) so that enabling tax later does not require replacing prices, but this attribute has no effect while automatic tax is off.

Alternative rejected: enabling automatic tax per the original design. It makes every Checkout Session fail for this account, so the product could not be sold.


## Risks / Trade-offs

- **USD price on a Brazilian account settles in BRL.** Charging USD protects BRL revenue from a weakening real but does not create a USD balance. A foreign entity is a future business decision.
- **No recurring Pix.** Stripe Brazil does not offer Pix Automático. Card is the only subscription method; an annual one-time Pix pass is a future alternative outside this change.
- **US$ 1.90 ticket fees.** The fixed fee and currency conversion make the effective fee roughly 12% on the monthly USD price. The annual plan is more efficient; raising the monthly USD price is a product option.
- **Missed or out-of-order webhooks.** Stripe retries failures for up to three days; the plugin does not re-fetch the latest subscription. A reconciliation job is a follow-up if local state drifts.
- **User deletion with an active subscription.** The plugin does not block user deletion. The admin flow must cancel the Stripe subscription before deleting a user; a guard is a follow-up.
- **Plugin 1.7.14 `limits` mismatch.** Do not set `limits` in the plan config; the bundled schema has no such column.
- **Stripe Tax is unavailable.** The Brazilian account cannot enable automatic tax, so the advertised prices are the final totals and the seller must handle tax outside Stripe. If fully hands-off tax is required, a merchant of record is the only option, and Stripe Managed Payments is not available to a Brazilian business.
- **No feature gating.** This change grants an entitlement only. Until the feature changes land, a supporter subscription has no visible in-app benefit beyond the future badge/features. The client must not advertise benefits that do not exist yet.
- **Currency display vs checkout.** `CF-IPCountry` is only a display hint. If the displayed currency and Checkout differ, the charge follows Stripe's localization; forcing `currency` in `getCheckoutSessionParams` is the deterministic fallback.
- **Client work is separate.** The server can sell nothing until `game-node-clients` replaces the Patreon button and adds the billing settings screen.

## Migration Plan

1. Add the dependencies and the additive migration; run it against a disposable database and verify `up`/`down`.
2. Create the Stripe product, the two multi-currency Prices, the webhook endpoint and the Customer Portal configuration.
3. Add the four environment variables to the deployment secrets and Compose definitions.
4. Deploy the API with the plugin enabled; verify startup, webhook signature and `GET /billing/offers`.
5. Run a test-mode purchase for monthly BRL, monthly USD, annual BRL and annual USD; verify the advertised total, `GET /billing/me`, cancel and restore.
6. Roll back by disabling checkout and the plugin, keeping the `subscription` table for audit; cancel active Stripe subscriptions only if the product is being withdrawn. Do not drop the table in production while Stripe subscriptions remain active.

## Open Questions

None that change the approach or the task breakdown. Feature gates, the supporter badge, the client UI and a reconciliation job are deferred follow-ups. Tax registration coverage and filing/remittance are operational prerequisites, not code deferred by this change.
