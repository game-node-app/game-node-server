# Spec Delta

## Purpose

Lets users buy and manage a Stripe-backed supporter subscription priced in BRL or USD, and exposes a durable entitlement for future supporter benefits. Prices are the final customer-facing total; Stripe Tax is unavailable for the seller's Stripe account country and is not used.

## ADDED Requirements

### Requirement: Supporter plan pricing
The system SHALL offer one supporter plan with monthly and annual intervals. Monthly SHALL cost R$ 9.90 in BRL or US$ 1.90 in USD; annual SHALL cost R$ 99.00 in BRL or US$ 19.00 in USD. Each interval SHALL use one Stripe multi-currency Price whose default currency is USD and whose BRL option carries the Brazilian amount.

#### Scenario: Monthly Brazilian price
- **WHEN** a customer in Brazil views the monthly supporter offer
- **THEN** the system presents R$ 9.90 per month

#### Scenario: Monthly international price
- **WHEN** a customer outside Brazil views the monthly supporter offer
- **THEN** the system presents US$ 1.90 per month

#### Scenario: Annual price by currency
- **WHEN** a customer chooses the annual supporter offer
- **THEN** the system presents R$ 99.00 for Brazil or US$ 19.00 for other regions

### Requirement: Offer display
The system SHALL expose supporter prices through `GET /v1/billing/offers` without exposing Stripe Price IDs, secret keys or a charge amount supplied by the client. The endpoint SHALL select the displayed currency from `CF-IPCountry`, falling back to `Accept-Language`, then USD.

#### Scenario: Brazilian offer display
- **WHEN** a request to the offers endpoint carries `CF-IPCountry: BR`
- **THEN** the response contains the BRL amounts and the BRL currency

#### Scenario: International offer display
- **WHEN** a request to the offers endpoint carries a non-Brazilian country or no country header
- **THEN** the response contains the USD amounts and the USD currency

#### Scenario: No internal identifiers exposed
- **WHEN** any client reads the offers response
- **THEN** the response contains no Stripe Price ID, secret key or webhook secret

### Requirement: Authenticated checkout
An authenticated user SHALL be able to start a monthly or annual supporter subscription through `POST /v1/billing/checkout`. The system SHALL select the plan and interval server-side, create a Stripe Checkout Session and return its URL. The client SHALL NOT supply a Price ID, amount or currency for the charge.

#### Scenario: Monthly checkout
- **WHEN** an authenticated user without an active subscription requests a monthly checkout
- **THEN** the system returns a Stripe Checkout URL for the monthly supporter Price

#### Scenario: Annual checkout
- **WHEN** an authenticated user requests an annual checkout
- **THEN** the system returns a Stripe Checkout URL for the annual supporter Price

#### Scenario: Unauthenticated checkout
- **WHEN** a request without a valid session calls the checkout endpoint
- **THEN** the system responds with HTTP 401 and creates no Checkout Session

#### Scenario: Existing active subscription
- **WHEN** an authenticated user with an active or trialing supporter subscription requests a new checkout
- **THEN** the system responds with HTTP 409 and does not create a second subscription

#### Scenario: Client-supplied amount ignored
- **WHEN** a client sends a price, amount or currency alongside the checkout request
- **THEN** the system ignores those values and uses its own plan and interval selection

### Requirement: Subscription lifecycle synchronization
The system SHALL synchronize subscription status, current period end, billing interval and cancel-at-period-end from Stripe webhooks. It SHALL process checkout completion, subscription creation, update and deletion, and SHALL reject events with an invalid signature without changing state.

#### Scenario: Checkout completed
- **WHEN** Stripe reports a completed checkout for a supporter subscription
- **THEN** the system records the subscription as active with its current period end and billing interval

#### Scenario: Renewal
- **WHEN** Stripe reports a subscription update after a successful renewal
- **THEN** the system updates the stored current period end

#### Scenario: Failed payment
- **WHEN** Stripe reports a subscription as past due after a failed payment
- **THEN** the system records the past-due status without deleting the subscription

#### Scenario: Cancellation at period end
- **WHEN** Stripe reports that a subscription will cancel at the end of the paid period
- **THEN** the system records the pending cancellation and keeps the subscription active until that period ends

#### Scenario: Invalid webhook signature
- **WHEN** a webhook request fails Stripe signature verification
- **THEN** the system rejects the request and changes no subscription state

#### Scenario: Duplicate webhook delivery
- **WHEN** Stripe delivers the same subscription event more than once
- **THEN** the system converges on one subscription record and does not create a duplicate

### Requirement: Supporter entitlement
The system SHALL expose `isSupporter(userId)` and `GET /v1/billing/me`. A user SHALL be a supporter while the subscription is active or trialing, while past due within a three-day grace period, or while a canceled subscription's paid period has not ended. Incomplete, unpaid, paused and expired subscriptions SHALL NOT grant entitlement.

#### Scenario: Active subscription
- **WHEN** a user's only subscription is active
- **THEN** the entitlement check returns true

#### Scenario: Past due within grace
- **WHEN** a user's subscription is past due and the paid period ended less than three days ago
- **THEN** the entitlement check returns true

#### Scenario: Past due after grace
- **WHEN** a user's subscription is past due and the paid period ended more than three days ago
- **THEN** the entitlement check returns false

#### Scenario: Canceled but still paid
- **WHEN** a subscription is canceled and its current period end is in the future
- **THEN** the entitlement check returns true

#### Scenario: No paid subscription
- **WHEN** a user has no subscription or only an incomplete, unpaid or paused subscription
- **THEN** the entitlement check returns false

#### Scenario: Own entitlement response
- **WHEN** an authenticated user reads the billing status endpoint
- **THEN** the response contains the entitlement flag, status, plan, billing interval, current period end and cancel-at-period-end

### Requirement: Self-service management
An authenticated user SHALL be able to open the Stripe Customer Portal, cancel the active subscription at period end and restore a pending cancellation. Only the subscription owner SHALL perform these actions.

#### Scenario: Billing portal
- **WHEN** an authenticated supporter requests the billing portal
- **THEN** the system returns a Stripe Customer Portal URL for that user's customer

#### Scenario: Cancel at period end
- **WHEN** an authenticated supporter requests cancellation
- **THEN** the system marks the subscription to cancel at the end of the paid period and keeps entitlement until that period ends

#### Scenario: Restore pending cancellation
- **WHEN** an authenticated supporter with a pending cancellation requests restoration
- **THEN** the system clears the pending cancellation and the subscription renews normally

#### Scenario: Free user management
- **WHEN** a user without a Stripe customer or subscription requests the portal, cancellation or restoration
- **THEN** the system responds with HTTP 404 or 409 and changes no subscription

#### Scenario: Another user's subscription
- **WHEN** a user attempts to manage a subscription that belongs to another user
- **THEN** the system rejects the request and changes no subscription

### Requirement: Billing security and failure behavior
The system SHALL keep Stripe credentials and Price IDs server-side. Billing endpoints SHALL require a session except the public offer display. If Stripe is not configured, billing endpoints SHALL return HTTP 503, and a failed checkout SHALL NOT grant entitlement.

#### Scenario: Stripe not configured
- **WHEN** a billing endpoint is called while the Stripe credentials or Price IDs are absent
- **THEN** the system responds with HTTP 503 and creates no subscription

#### Scenario: Checkout provider failure
- **WHEN** Stripe rejects or fails the Checkout Session creation
- **THEN** the system returns an error and records no active subscription

#### Scenario: Unauthenticated management
- **WHEN** a request without a valid session calls checkout, portal, cancellation or restoration
- **THEN** the system responds with HTTP 401 and changes no subscription

### Requirement: Stripe-only provider scope
The system SHALL grant supporter entitlement only from Stripe subscription state. It SHALL NOT grant entitlement from Patreon, and it SHALL NOT offer recurring Pix.

#### Scenario: Patreon does not grant entitlement
- **WHEN** a person has a Patreon pledge but no Stripe subscription
- **THEN** the entitlement check returns false

#### Scenario: Recurring Pix is not offered
- **WHEN** a user starts a supporter subscription checkout
- **THEN** the available recurring payment method is card-based and recurring Pix is not presented
