# Implementation validation — supporter subscriptions

Environment: Stripe sandbox `acct_1UXhg28UHElGyBtR` (test mode, Brazilian account), MySQL 8.4.13 in
`docker compose`, Node 24, `better-auth@1.7.14`, `@better-auth/stripe@1.7.14`,
`better-call@1.4.4`, `stripe@23.1.0`. Secrets are redacted.

## 1. Dependencies (task 1.1)

```
yarn add @better-auth/stripe@1.7.14 stripe@^23
info Direct dependencies
├─ @better-auth/stripe@1.7.14
└─ stripe@23.1.0
```

The plugin's peer range accepts `stripe@^18`–`^23`; `better-call@1.4.4` is present at the root.

## 2. Stripe configuration (tasks 1.2, 1.3)

Product `GameNode Supporter` (`prod_VaLxLpPg7hlQSW`), two Prices:

| Interval | Price | Default | BRL option |
| --- | --- | --- | --- |
| Monthly | `price_1UZBF98UHElGyBtRxhMPdLHb` | USD 190 | 990 |
| Yearly | `price_1UZBF98UHElGyBtR8jOhuWvU` | USD 1900 | 9900 |

Both were updated to `tax_behavior: "inclusive"` at the top level and on `currency_options.brl`,
verified with `expand[]=currency_options`. Webhook endpoint `we_1UZBmm8UHElGyBtRUEk2k58E` points to
`https://server.gamenode.app/v1/auth/stripe/webhook` with the four subscription events; its signing
secret is in the local `.env` only.

### Stripe Tax is unavailable (blocker recorded)

```
POST /v1/checkout/sessions with automatic_tax.enabled=true
→ Stripe Tax is not supported for your account country.

GET /v1/tax/settings, GET/POST /v1/tax/registrations, POST /v1/tax/calculations
→ Stripe Tax isn't yet supported for your country.
```

Per the approved decision, checkout does not enable `automatic_tax`, does not require a tax address
and does not collect a tax ID. A test Checkout Session without tax succeeds; see the matrix below.
The spec and design were updated accordingly.

## 3. Migration (task 2.1)

Applied the full chain to a disposable database (`gamenode_billing_test`):

```
DB_DATABASE=gamenode_billing_test yarn migration:run
Migration AddStripeSupporterSubscriptions1794600000000 has been executed successfully.

DB_DATABASE=gamenode_billing_test yarn typeorm migration:revert -d ./data-source.ts
Migration AddStripeSupporterSubscriptions1794600000000 has been reverted successfully.

DB_DATABASE=gamenode_billing_test yarn migration:run
→ executed successfully (left applied)
```

`SHOW CREATE TABLE subscription`: 19 columns, primary key `id`, unique
`subscription_stripeSubscriptionId_unique`, indexes `subscription_referenceId_idx` and
`subscription_stripeCustomerId_idx`. `information_schema` returned no `limits` column and no foreign
key on `referenceId`. `user.stripeCustomerId` is `varchar(255) NULL` with `user_stripeCustomerId_idx`.

The same migration was then applied to the local `gamenode` database for the smoke tests.

## 4. Auth plugin and app boot (tasks 3.1, 3.2)

- With the four Stripe values: the app starts, `/v1/billing/*` is mapped, and checkout creates a
  Stripe customer + Checkout Session.
- With all four blank: the app starts and `GET /v1/billing/offers` and `GET /v1/billing/me` both
  return 503 `Billing is not configured`.
- `yarn test auth/auth.integration.spec.ts --runInBand`: 41/41 passed.
- `getSubscriptions` returns the plugin rows through the Better Auth adapter; the entitlement and
  `/billing/me` checks read them without a TypeORM entity or constructor cycle.

## 5. Automated checks (task 5.2)

```
yarn test:typecheck        → passed
yarn build                 → passed
yarn test src/billing --runInBand → 2 suites, 46 tests passed
```

## 6. Test-mode smoke test (tasks 3.3, 5.3)

Local server at `http://127.0.0.1:5000`, one test user with a manually created session, one real
Stripe subscription on a 7-day trial (`sub_1UZC7j8UHElGyBtRtGWVdvaZ`), test-mode Checkout Sessions
created through `POST /v1/billing/checkout` and expired afterwards.

### Checkout matrix (all sessions `automatic_tax.enabled=false`)

| Request | Session | Interval | Amount | Stripe session |
| --- | --- | --- | --- | --- |
| `interval=monthly`, `CF-IPCountry: BR` | `cs_test_...ARkGa` | month | 990 BRL | open → expired |
| `interval=monthly`, no country header | `cs_test_...rioZ` | month | 190 USD | open → expired |
| `interval=yearly`, `CF-IPCountry: BR` | `cs_test_...Og3G1v` | year | 9900 BRL | open → expired |
| `interval=yearly`, no country header | `cs_test_...37bKn` | year | 1900 USD | open → expired |

A request that also sent `price`, `amount` and `currency` fields still produced the server-selected
USD 190 monthly session; the extra fields are ignored.

### Webhooks (`POST /v1/auth/stripe/webhook`)

Events were signed with `stripe.webhooks.generateTestHeaderString` using the endpoint secret.

| Check | Result |
| --- | --- |
| Valid `checkout.session.completed` (synthetic session pointing at the real subscription) | 200 `{"success":true}`; the plugin retrieved the subscription and refreshed the row (`plan=supporter`, `billingInterval=month`, `periodEnd` set); completion hook logged |
| Valid `customer.subscription.updated` (trialing) | 200 `{"success":true}`; row became `trialing`, `billingInterval=month`, `periodStart/periodEnd` set; `GET /billing/me` returned `isSupporter=true`, `status=trialing` |
| Duplicate delivery | 200; `COUNT(*)` for the Stripe subscription stayed 1 |
| Invalid signature (`customer.subscription.deleted`) | 400 `Failed to construct Stripe event`; row stayed `trialing`, `cancelAtPeriodEnd=1` |
| Missing signature | 400 |
| Valid update with `cancel_at_period_end=true` after cancel | row `cancelAtPeriodEnd=1`; `/billing/me` reflected it |

### Management

| Check | Result |
| --- | --- |
| `POST /billing/checkout` while trialing | 409 `An active subscription already exists; manage it instead` |
| `POST /billing/cancel` | 200 `{status:"trialing", cancelAtPeriodEnd:true, periodEnd:...}` |
| `POST /billing/restore` immediately after cancel (row still stale) | 200; the service checked Stripe and cleared the pending cancellation |
| `POST /billing/restore` with nothing pending | 409 |
| `POST /billing/portal` | 200 with a `https://billing.stripe.com/...` URL |
| Unauthenticated `POST /billing/checkout`, `GET /billing/me` | 401 |
| All billing routes with the four values blank | 503 |

### Not available / not performed

- No card was entered, so no Checkout Session was completed and no invoice, renewal or real charge
  occurred. Webhook processing was verified with signed events carrying a real Stripe subscription.
- The Stripe CLI is not installed; the equivalent signed requests were sent with the Stripe Node
  SDK. Production webhook delivery remains to be observed after deploy.
- No live-mode test. The sandbox account cannot use Stripe Tax (see section 2).
- Customer Portal default configuration was used; no custom portal branding was set.
