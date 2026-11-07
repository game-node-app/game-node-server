# GOG contract check — task 1.1

Checked on 2026-11-03. Task 1.1 records the available contract evidence. A privately supplied fresh
authorization code was exchanged successfully, and authenticated profile,
library, playtime, achievement and refresh requests were performed. Raw responses
and credentials remain in a private temporary directory outside the repository.
No runtime provider registration or import behavior was changed.

## Pinned primary client sources

- Heroic: `509a34feea8541b73c928e289f2cf262d432db4a`.
- heroic-gogdl: `6c6ef53fd4965d8d9b943c73d9400fe55eadc6ba`.
- Comet: `46c91529a07ab4d4ab0397429dc07d4f2f66431a`.

### Login, tokens and identity

[Heroic login](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/frontend/screens/WebView/index.tsx)
uses `https://auth.gog.com/auth`, the Galaxy layout, authorization-code response,
launcher client `46899977096215655`, and
`https://embed.gog.com/on_login_success?origin=client` as redirect URI.

[gogdl authorization](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/6c6ef53fd4965d8d9b943c73d9400fe55eadc6ba/gogdl/auth.py)
uses GET requests to `https://auth.gog.com/token` for code exchange and refresh,
with protocol client constants and grant values in the query. It replaces stored
credentials after a successful refresh and calculates expiry from `expires_in`
in seconds. Its failure handling does not establish a specific revoked-grant
response shape.

[Credential/profile types](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/common/types/gog.ts)
declare string `user_id`, access/refresh tokens and numeric `expires_in`; the
profile has string `id` and `username`.
[Profile retrieval](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/backend/storeManagers/gog/user.ts)
uses a bearer token at `https://users.gog.com/users/{user_id}`.

### Library and cumulative time

[Library retrieval](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/backend/storeManagers/gog/library.ts)
uses the account releases route with `page_token` and `next_page_token` and
filters `platform_id === "gog"`. The types above declare `total_count`, `limit`,
`items`, string `external_id` and boolean `owned`.

[Game requests](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/backend/storeManagers/gog/games.ts)
read `time_sum` from `/games/{productId}/users/{userId}/sessions`.
[IPC](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/backend/main.ts)
returns that value through `getPlaytimeFromRunner`;
[the frontend](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/frontend/screens/Game/TimeContainer/index.tsx)
stores it unchanged and displays it as minutes. This supports the proposed
minutes-to-seconds conversion; the known-game account comparison required by D5
has not been performed.

### Achievements

The game requests above use `/clients/{productId}/users/{userId}/achievements`,
a bearer token and `X-Gog-Lc`. They read only `items`, cache by product, and
return an empty array on failure. That is insufficient evidence of completeness,
unsupported status or account isolation for this server.

[Heroic achievement types](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/509a34feea8541b73c928e289f2cf262d432db4a/src/common/types.ts)
declare string `achievement_id`, string-or-null `date_unlocked`, names,
descriptions, visibility and locked/unlocked image URLs.

[Comet retrieval](https://github.com/imLinguin/comet/blob/46c91529a07ab4d4ab0397429dc07d4f2f66431a/src/api/gog/achievements.rs)
declares `total_count`, `limit`, `page_token`, `items` and `achievements_mode`,
but does not follow continuation. It uses the game's client ID and a token from
that client's token-store entry. This does not establish whether every library
product ID works with the launcher grant.
[Comet date handling](https://github.com/imLinguin/comet/blob/46c91529a07ab4d4ab0397429dc07d4f2f66431a/src/api/handlers/communication_service.rs)
parses unlock dates with Chrono and constructs RFC 3339 dates when unlocking.
No real unlocked response was captured here; all eight owned GOG products
returned empty achievement sets.

## Live fixtures and outcomes

`fixtures/invalid-refresh.json` records HTTP 400 from a GET token request with
the evidenced launcher constants and a deliberately invalid refresh token.
Only status and error fields were retained; no request URL, query, headers,
tokens or account data were saved. This verifies the invalid-token response,
not every possible expired/revoked-grant response.

Additional fixtures are projections of authenticated responses. Access/refresh
tokens and username use explicit redaction markers, account/product IDs are
synthetic strings, and unrelated profile/library fields are omitted. The library
fixture preserves every release and the observed total; it is not a shortened
page presented as complete.

`fixtures/response-shapes.json` separately records every observed top-level field
name and JSON type for token, profile, library, sessions, achievements and product
responses, plus the union of library-item field names/types across all releases.
It contains no response values. Empty achievement results do not establish item
field types; the primary-client achievement types remain the evidence for those.

- Code exchange: the first submitted code received HTTP 400 `invalid_grant`;
  a fresh code received HTTP 200. `invalid-authorization-code.json` retains only
  the first response's status and error code, without its description.
- `token-response.json`: successful refresh payload, with a finite positive
  expiry, matching string account identity, changed access token and unchanged
  refresh token. Rotation was not observed in this refresh.
- `profile.json`: HTTP 200; profile ID exactly matched token `user_id`.
- `library-complete.json`: HTTP 200; 121 releases, reported limit 500, no
  continuation field, eight owned GOG products. Other platforms were present.
  Separate `limit=2` and `page_size=2` probes were both ignored: each returned
  the same complete page. Neither query parameter is established as supported.
- `sessions-zero.json`: HTTP 200 with integer `time_sum: 0`. All eight owned
  GOG products returned that same shape and zero value.
- `achievements-empty.json`: HTTP 200 with `total_count: 0`, `limit: 1000`,
  `page_token: "0"`, `items: []`, and `achievements_mode: "all_visible"`.
  All eight products returned this shape. This is an observed empty result,
  not proof of a definitive unsupported-game response or of SDK client identity.
- Public product lookups succeeded for the eight GOG products and identified
  them as games. This establishes the optional product metadata route independently
  of the library's null title fields.

Self-checks verified the redacted library count, owned-GOG filtering, token/profile
identity relationship, and absence of actual credentials, account ID, username,
email and session ID in the saved fixtures.

## Live evidence still required before rollout

- A known game's cumulative time compared with GOG's displayed value.
- Locked, unlocked and hidden achievement responses using a library product ID
  and the launcher grant; preserve exact date representations and envelope fields.
- A complete achievement result or actual continuation response proving how to
  detect and handle truncation. Neither reviewed client implements pagination.
- A definitive unsupported-game response distinct from authentication,
  authorization, missing-product and transient failures.

The connected account currently supplies only zero-time/empty-achievement
examples for its owned GOG products. A title with Galaxy-recorded time and actual
GOG achievements, or equivalent verified primary-client captures, is still needed
to exercise the remaining contracts. No sessions or achievements were written
to GOG during these checks.

The user confirmed that this account has never been used to play GOG games and
requested that the field names and responses be retained for validation with
another user's data. These captures satisfy that recording request; nonzero-time,
nonempty-achievement and unsupported-result checks remain pending. No further
account activity or unlocks should be requested from this user for this capture.

On 2026-11-03 the user explicitly authorized implementation using the current
evidence, keeping real-account validation and rollout pending. Task 1.1 is
therefore checked; the missing live checks above remain acceptance gaps for
task 6.3, not fabricated successful captures.

Keep rollout pending. Do not infer unsupported from a
generic 403/404, fabricate success fixtures, assume a first page is complete, or
add a product-to-SDK-client resolver without resolving the design scope.
