# Supporter billing — client handoff

Server implementation of the `supporter` plan. Client UI, the supporter badge, feature gating and
the Patreon button removal are separate changes in `game-node-clients`; this document only fixes the
HTTP contract.

Regenerate the client from `server_swagger.json`. All routes are under `/v1` and use the normal
Better Auth session (cookie or `Authorization: Bearer <token>`); unauthenticated protected calls
return 401.

## Prices

| Interval | BRL | USD |
| --- | --- | --- |
| `monthly` | R$ 9.90 (`990`) | US$ 1.90 (`190`) |
| `yearly` | R$ 99.00 (`9900`) | US$ 19.00 (`1900`) |

Amounts are minor units. The advertised amount is the final total; Stripe Tax is not enabled for
this account. The server selects the currency; clients must never send a Price ID, amount or
currency for the charge.

## `GET /v1/billing/offers` (public)

Currency comes from `CF-IPCountry: BR`, then a `pt*` `Accept-Language`, then USD.

```json
{
    "currency": "BRL",
    "offers": [
        { "plan": "supporter", "interval": "monthly", "amount": 990, "displayAmount": "R$ 9,90" },
        { "plan": "supporter", "interval": "yearly", "amount": 9900, "displayAmount": "R$ 99,00" }
    ]
}
```

The response contains no Stripe Price IDs, keys or secrets. When billing is not configured the
endpoint returns 503.

## `POST /v1/billing/checkout`

```json
{ "interval": "monthly", "locale": "pt-BR" }
```

`interval` is `monthly` or `yearly`; `locale` is optional and passed to Stripe Checkout. Any other
field (price, amount, currency) is ignored.

Response:

```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

Navigate the user to `url`. The server owns the success and cancel URLs:
`https://gamenode.app/supporter?checkout=success` and `...?checkout=cancel`. The client must serve a
`/supporter` page that reads `checkout` and then calls `GET /v1/billing/me`.

Errors: 400 invalid interval or Stripe rejection; 401 unauthenticated; 409 an active or trialing
subscription already exists; 503 billing not configured. A failed checkout grants no entitlement.

## `GET /v1/billing/me`

```json
{
    "isSupporter": true,
    "status": "trialing",
    "plan": "supporter",
    "billingInterval": "month",
    "periodEnd": "2026-11-14T16:05:47.000Z",
    "cancelAtPeriodEnd": false
}
```

With no subscription every field except `isSupporter` is `null` (and `cancelAtPeriodEnd` is `null`).
`isSupporter` is true for `active` and `trialing`, for `past_due` within three days of
`periodEnd`, and for `canceled` while `periodEnd` is in the future. `incomplete`,
`incomplete_expired`, `unpaid` and `paused` are false.

## `POST /v1/billing/portal`

```json
{ "locale": "pt-BR" }
```

Returns `{ "url": "https://billing.stripe.com/..." }`. Use it to update the card and view invoices.
Errors: 404 when the user has no Stripe customer or subscription; 503 billing not configured. The
portal returns the user to `https://gamenode.app/supporter`.

## `POST /v1/billing/cancel`

No body. Sets `cancel_at_period_end` on the active subscription and returns:

```json
{ "status": "active", "cancelAtPeriodEnd": true, "periodEnd": "2026-12-07T16:05:47.000Z" }
```

Entitlement lasts until `periodEnd`. Errors: 404 no active subscription; 503 billing not configured.

## `POST /v1/billing/restore`

No body. Clears a pending cancellation and returns:

```json
{ "status": "active", "cancelAtPeriodEnd": false, "periodEnd": "2026-12-07T16:05:47.000Z" }
```

Errors: 404 no active subscription; 409 no pending cancellation; 503 billing not configured. The
server checks Stripe directly when the local row has not received the cancellation webhook yet, so
cancel followed immediately by restore works.

## Error envelope

Nest's standard shape:

```json
{ "message": "An active subscription already exists; manage it instead", "error": "Conflict", "statusCode": 409 }
```

## Not in this change

- No supporter badge, premium feature gating or collection limit.
- No client billing screen, no Patreon removal.
- No tax calculation or tax ID collection; Stripe Tax is unavailable for the seller's account
  country.
