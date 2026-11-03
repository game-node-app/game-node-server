# GOG client handoff

Implementation uses the recorded GOG/primary-client contracts. Real-account
validation and rollout remain pending; see `contract-evidence.md`. Client UI
implementation is outside this server change.

## Additive API values

Regenerate the API wrapper from `server_swagger.json`. Add `gog` to connection,
importer and notification-provider handling. Playtime source `gog` and external
mapping category `Gog = 5` already exist. Display `GOG`; use `iconName: "gog"`
and the existing `/v1/public/icons/gog.png` asset. Do not construct profile or
store URLs from numeric GOG IDs.

`GET /v1/connections` includes:

```json
{
    "type": "gog",
    "name": "gog",
    "iconName": "gog",
    "authMode": "delegated_code",
    "isImporterViable": true,
    "isImporterWatchViable": true,
    "isPlaytimeImportViable": true,
    "isAchievementImportViable": true
}
```

## Login on desktop and mobile

1. Send authenticated `POST /v1/connections/gog/auth/init` with `{}` or the existing
   `isAutoImportEnabled` / `autoImportCollectionId` preferences. Retain both
   `authorizationUrl` and the GameNode `state` returned by the endpoint.
2. Open `authorizationUrl` in the browser. Sign in to GOG. Desktop: copy the full
   final URL from the address bar. Mobile: copy it from the browser address/share
   control, return to the app and paste it. Browser-specific mobile handling still
   needs validation; allow completing this step from a desktop browser.
3. Submit the full `https://embed.gog.com/on_login_success?origin=client&code=...`
   URL as `callbackParams.code`. Do not extract just the code, request the URL,
   or ask the user to paste access/refresh tokens.

Callback request shape (placeholders only):

```json
{
    "state": "<state returned by init>",
    "callbackParams": {
        "code": "https://embed.gog.com/on_login_success?origin=client&code=<one-use authorization code>"
    }
}
```

Send this to `POST /v1/connections/gog/auth/callback`. The response is the existing
safe connection DTO with `type: "gog"`, account display identity, preferences,
capability flags and `authStatus: "connected"`; it contains no credentials.
Manual `POST /v1/connections` linking is rejected for GOG. State expires after ten
minutes and is single use. On a failed exchange restart init rather than reusing
state. Avoid recording the pasted URL in logs, analytics or crash reports.

## Reconnect, imports and achievements

- Handle `authStatus: "reauth_required"` and `connection.reauth-required` targets
  with `provider: "gog"` using the existing reconnect flow. Start init/callback
  again; the server resumes eligible sync after successful reconnect. Settings
  and deletion keep the existing endpoints and collection ownership rules.
- Importer routes/source selectors accept `gog`. Owned GOG games, including
  unplayed ones, use PC platform `6`. Other stores linked through Galaxy are
  excluded. Processed/ignored and automatic collection behavior are unchanged.
- Playtime covers only GOG-recorded cumulative activity. Missing dates/counts are
  preserved; offline play that GOG never recorded cannot be imported.
- Existing achievement reads return `source: 5`, `sourceName: "GOG"`,
  `sourceAbbreviatedName: "GOG"`, `iconName: "gog"`, `platformIds: [6]`.
  Definition `externalId` equals obtained `externalId` (`achievement_id`). GOG has
  no platinum metadata. Respect empty hidden text instead of inventing a title.
- Owner obtained reads can enqueue a refresh; other-user/public reads expose
  persisted progress without granting refresh authority. Catalogue retrieval
  requires a usable connected account on the server. Provider failures or
  truncated snapshots must remain retryable/unavailable, not displayed as a
  confirmed absence of achievements.
