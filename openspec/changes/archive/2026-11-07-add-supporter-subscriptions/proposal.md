# Proposal

## Why

GameNode has no server-side paid membership: the landing page only links to Patreon, and the server cannot tell who is a supporter. The project needs a self-service subscription that works for Brazilian and international users, grants a durable entitlement, and can be managed in-app.

## What Changes

- Adopt Stripe as the only subscription provider. Discard Patreon as a product path: no Patreon integration is added, and the existing Patreon link is removed in the client change. The server has no Patreon code today.
- Integrate `@better-auth/stripe@1.7.14` with the existing `better-auth@1.7.14` instance and add `stripe@^23`.
- Add one `supporter` plan with monthly and annual intervals backed by Stripe multi-currency Prices: USD as the default currency with a BRL option. Monthly: US$ 1.90 / R$ 9.90. Annual: US$ 19.00 / R$ 99.00.
- Add the Better Auth Stripe schema (`user.stripeCustomerId` and the `subscription` table) through a TypeORM migration.
- Add a `BillingModule` that wraps the plugin's server API: `GET /v1/billing/offers`, `POST /v1/billing/checkout`, `GET /v1/billing/me`, `POST /v1/billing/portal`, `POST /v1/billing/cancel` and `POST /v1/billing/restore`.
- Expose a provider-agnostic `isSupporter(userId)` entitlement computed from the plugin's subscription state, including a short past-due grace period.
- Keep the advertised R$ 9.90 / US$ 1.90 as the customer-facing total. Stripe Tax is not available for the account's country (Brazil), so checkout does not enable `automatic_tax` or collect a tax ID; tax registration, filing and remittance remain the seller's responsibility and are out of scope for this change.
- Configure the Stripe webhook at `/v1/auth/stripe/webhook` and the required environment variables.
- Out of scope: implementing or gating premium features (video cover, animated border, theme, custom covers, live profile, supporters wall, collection limit), profile badge, client UI changes, Patreon migration, Mercado Pago, recurring Pix, Stripe Tax, tax registration/filing operations and foreign-entity/USD settlement.
- **BREAKING**: none. The migration is additive and no existing endpoint changes behavior.

## Capabilities

### New Capabilities

- `supporter-subscriptions`: Stripe-backed supporter subscription purchase, lifecycle synchronization, entitlement, BRL/USD pricing and self-service management.

### Modified Capabilities

- None.

## Impact

- New `src/billing/` module (controller, service, DTOs and types) registered in `src/app.module.ts`.
- `src/auth/auth.service.ts` gains the Stripe client/plugin configuration and a subscription lookup helper; `src/auth/auth.module.ts` exports it as needed.
- New TypeORM migration adding `user.stripeCustomerId` and the `subscription` table with indexes.
- `package.json` and `yarn.lock`: `@better-auth/stripe@1.7.14` and `stripe@^23`.
- `.env.example`, `docker-compose.yml` and `docker-compose.prod.yml`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SUPPORTER_MONTHLY` and `STRIPE_PRICE_SUPPORTER_YEARLY`.
- Stripe Dashboard: one product, two multi-currency prices, a webhook endpoint and a customer portal configuration.
- No changes to profile, collections or other feature endpoints in this change.
- Client UI (checkout call-to-action, billing settings and supporter badge) is a separate change in `game-node-clients`.
