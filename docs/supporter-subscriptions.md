# Supporter subscriptions

Server-side Stripe subscription for the `supporter` plan. The Better Auth Stripe plugin owns
customer creation, Checkout, webhook verification and the `subscription` table; `BillingModule`
exposes the GameNode API and entitlement. Client UI, the supporter badge and feature gating are
separate changes.

## Plan and prices

One plan, `supporter`, with two intervals and one multi-currency Stripe Price per interval:

| Interval | Default (USD) | BRL option |
| --- | --- | --- |
| Monthly | US$ 1.90 (`190`) | R$ 9.90 (`990`) |
| Annual | US$ 19.00 (`1900`) | R$ 99.00 (`9900`) |

Amounts are Stripe minor units. Both Prices carry `tax_behavior: "inclusive"` at the top level and
in `currency_options.brl`, but Stripe Tax is not enabled (see below), so the advertised amount is
the final total.

`GET /v1/billing/offers` selects BRL from `CF-IPCountry: BR`, then from a `pt*` `Accept-Language`,
then USD. Checkout uses the same rule and sends the selected currency to Stripe; Stripe Checkout
does not localize a multi-currency Price on its own.

## Environment

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API key (test or live) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the webhook endpoint |
| `STRIPE_PRICE_SUPPORTER_MONTHLY` | Price ID of the monthly Price |
| `STRIPE_PRICE_SUPPORTER_YEARLY` | Price ID of the annual Price |

All four are required to enable billing. With any missing, the app boots and every `/v1/billing/*`
endpoint returns 503. Set all four in production; `docker-compose.prod.yml` passes them through and
still boots without them for rollback. `.env` covers local development (the local `docker-compose.yml`
has no server service).

## Stripe Dashboard setup

1. Create one product, `GameNode Supporter`.
2. Create the monthly Price: USD 1.90, recurring monthly; add a BRL currency option of 990.
3. Create the annual Price: USD 19.00, recurring yearly; add a BRL currency option of 9900.
4. Set `tax_behavior` to `inclusive` on both Prices, at the top level and on the BRL option.
5. Add a webhook endpoint at `https://server.gamenode.app/v1/auth/stripe/webhook` for:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
6. Activate the Customer Portal. `POST /v1/billing/portal` returns its URL.

The webhook endpoint is public by design and must not be blocked by Cloudflare Access; it is
authenticated by the Stripe signature.

## Stripe Tax is not enabled

Stripe Tax is unavailable for the account's country (Brazil). Verified in the sandbox:

- `checkout.sessions.create` with `automatic_tax: { enabled: true }` fails with
  `Stripe Tax is not supported for your account country`.
- `GET /v1/tax/settings`, `GET/POST /v1/tax/registrations` and `POST /v1/tax/calculations` fail with
  `Stripe Tax isn't yet supported for your country`.

Decision: checkout does not enable `automatic_tax`, does not require a billing address for tax and
does not collect a tax ID. The advertised R$ 9.90 / US$ 1.90 and R$ 99.00 / US$ 19.00 are the final
customer-facing totals. The seller remains responsible for tax registration, filing and remittance;
a merchant of record would be required for fully hands-off tax.

## Local development

```bash
docker compose up -d db redis
yarn migration:run
# add the four STRIPE_* values to .env
yarn start
```

Signed webhook test without the Stripe CLI: build the event JSON, sign it with
`STRIPE_WEBHOOK_SECRET` using `stripe.webhooks.generateTestHeaderString`, and POST it to
`http://localhost:5000/v1/auth/stripe/webhook` with the `stripe-signature` header. Invalid and
missing signatures return 400 and change no state.

`yarn test src/billing --runInBand` covers offer selection, entitlement, checkout guards and the
cancel/restore errors.

## Production deployment order

1. Create the live product, the two Prices, the webhook endpoint and the Customer Portal; keep the
   live IDs ready.
2. Add the four secrets to the deployment. Compose passes them through; without them the API boots
   with billing disabled.
3. Run the migration (`server_migration` runs `yarn migration:run`). It only adds
   `user.stripeCustomerId` and the `subscription` table with its indexes.
4. Deploy the API. Verify boot, `GET /v1/billing/offers`, one Checkout Session and webhook delivery.
5. Smoke test monthly/yearly in BRL and USD, `GET /v1/billing/me`, cancel at period end, restore and
   the Customer Portal.
6. Enable the client call-to-action in `game-node-clients`.

## Rollback

- To stop selling without reverting code, remove one or more of the four Stripe variables; every
  billing endpoint then returns 503 and no new Checkout is created. Keep the `subscription` table.
- To redeploy the previous image, keep the additive migration applied. Do not drop
  `subscription` while Stripe subscriptions are still active: the local entitlement record would be
  lost while Stripe keeps charging. Cancel active subscriptions only if the product is withdrawn.
- The migration `down` drops the table and the `user.stripeCustomerId` column; use it only after
  all subscriptions are canceled and reconciled.

## Security

- Checkout, portal, cancel, restore and status require a session; `referenceId` is always the
  session user.
- The client never supplies a Price ID, amount or currency for the charge. `CF-IPCountry` only
  selects between two published prices and is not an authorization boundary.
- Stripe keys and the webhook secret stay server-side; offers expose only display amounts.
- The existing global throttler applies to the billing routes.
