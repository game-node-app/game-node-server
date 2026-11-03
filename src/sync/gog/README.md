# GOG adapter contracts

Evidence and sanitized live-response fixtures are in
[`contract-evidence.md`](../../../openspec/changes/add-gog-connection/contract-evidence.md).
`fixtures/` retains redacted token/profile/error copies for tests after the change
is archived.

- The Galaxy launcher client constants, fixed login-success callback and GET
  token grants follow the pinned
  [gogdl source](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/6c6ef53fd4965d8d9b943c73d9400fe55eadc6ba/gogdl/auth.py).
  They require no additional environment variables or dependency.
- `expires_in` is seconds. Initial exchange requires both tokens and a string
  account ID; refresh may omit the replacement refresh token or identity. The
  caller must preserve the current refresh token when no replacement is returned.
  No refresh-token expiry is established.
- Profile IDs must exactly match token IDs. Account IDs stay strings, including
  values beyond JavaScript's safe-integer range. Numeric IDs are rejected.
- Only the captured HTTP 400 `invalid_grant` response establishes an invalid
  refresh grant. Other statuses preserve ordinary retryable failure semantics.
  Helpers discard raw request errors and never log token queries or bearer headers.
  Requests have finite timeouts and do not follow redirects carrying credentials.
- Release pagination uses `next_page_token`. Achievement `page_token` was observed
  as `"0"` in empty results; it does **not** establish a next-page mechanism.
  Achievement item types follow pinned Heroic types and are not live fixtures.

Nonzero cumulative time, nonempty/hidden achievements, achievement continuation
and definitive unsupported responses still need the evidence listed in the
change. The provider is wired through the existing discovery, importer, playtime and
achievement pipelines. Rollout stays pending those validations; no guessed
success or unsupported behavior is added.
