# Client hand-off: Nintendo connection (`game-node-clients`)

Server change: `add-nintendo-connection`. The server adds connection type `nintendo` (`authMode: "delegated_code"`), importer source `nintendo`, notification provider `nintendo`, playtime source `nswitch` (already in the wrapper) and the GameNode-only mapping category `NintendoTitleId = 1002`. Paths below are relative to the `game-node-clients` repo root and were checked to exist.

## 0. API wrapper
Regenerate `@repo/wrapper` from the updated `server_swagger.json` first. `UserConnectionDto.type`, `NotificationConnectionTargetDto.provider` and the related enums gain `NINTENDO = "nintendo"`; exhaustive `match(...).exhaustive()` calls will fail to compile until the branches below exist.

## 1. Connection name and profile URL
- `packages/ui/src/components/connections/util/getConnectionName.ts`: add `.with(UserConnectionDto.type.NINTENDO, () => "Nintendo")`.
- `packages/ui/src/components/connections/util/getConnectionProfileURL.ts`: Nintendo has no public profile page, so return no URL for `NINTENDO` (follow how PSN/Xbox absence is handled there; do not link anywhere).

## 2. Importer source
- `packages/ui/src/components/importer/view/ImporterScreen.tsx`: add `"nintendo"` to `VALID_SOURCES`.

## 3. Connections list
- `apps/mobile/src/components/preferences/connections/PreferencesConnectionsItems.tsx`: render `<PreferencesConnectionItem type={UserConnectionDto.type.NINTENDO} />` next to Epic's. The web preferences screen reads the list from `GET /v1/connections`; check it shows the `nintendo` icon (`iconName: "nintendo"`, `public/icons/nintendo.png` exists on the server) and add a logo component beside `packages/ui/src/components/general/thirdparty/EpicGamesLogo.tsx` only if the existing screens use per-provider logos.

## 4. Paste-step copy (the main UX difference from Epic)
`packages/ui/src/components/preferences/handlers/connections/PreferencesConnectionDelegatedCode.tsx` already sends `callbackParams.code` trimmed, which is what the server needs. The `delegatedCode` strings in `packages/locales/src/translations/json/en.json` (line ~1096) and `pt-BR.json` are Epic-specific ("shows a page like this ... copy the highlighted code"). For Nintendo the text must say:
- Sign in to your Nintendo Account, pick the account, then **right-click (or long-press) the "Select this account" button, copy the link address, and do not click it**. Clicking it opens an app link that the browser cannot handle.
- Paste the whole link (it starts with `npf5c38e31cd085304b://auth#`).
- `invalidCode`: "We couldn't find a Nintendo account link in what you pasted."

Use a provider-specific key (for example `delegatedCode.nintendo.*`) or a `{{type}}` branch; regenerate `packages/locales/src/generated/translation-schema.d.ts` if keys are added. Desktop-first instructions: copying that link on mobile browsers is unverified, so tell mobile users they may need to link from a computer.

## 5. Coverage and privacy copy
Show on the Nintendo connection screen (en and pt-BR):
- Only games played on Switch or Switch 2 are imported, and only those played after the Nintendo Account was linked to a console. Games hidden in Nintendo's app are never imported. Owned but unplayed games are not included.
- Playtime and first/last played dates come from Nintendo.
- To revoke access: Nintendo Account settings, "Linked apps"/authorized apps (remove the entry for the Nintendo Store app login) or change the Nintendo Account password. Verify the exact menu names on the current Nintendo Account site before shipping the copy.

## 6. Notifications
- Connection reauth notifications already carry `provider: "nintendo"` and the server text "Your Nintendo connection needs to be reconnected." Add the provider to the mobile/web provider-to-name maps and translations used by `apps/mobile/src/components/notifications/connection-reauth-notification.test.tsx` (display name "Nintendo", importer route `/importer/nintendo`).
- Import-discovery notifications ("N new games ready to be imported from your Nintendo connection") need the same "Nintendo" display name.

## 7. Playtime form (optional)
`packages/ui/src/components/playtime/PlaytimeSubmitForm.tsx` lists manual playtime platforms; `source.NSWITCH` already exists in the wrapper, so only add an option if it is not already offered.

## 8. Admin app (curation)
Unmapped Nintendo titles appear in the existing curation queue under category `NintendoTitleId` (1002), with Nintendo's English title name and the 16-hex title ID as `sourceUid`.
- `apps/admin/src/components/external_game/constants.ts`: add `NintendoTitleId = 1002` beside `EpicGamesNamespace = 1001`.
- `apps/admin/src/components/external_game/utils/getExternalLookupUrl.ts`: there is no public store URL for title IDs; return no link (or a name search) for `NintendoTitleId`.

## 9. Tests
- `apps/mobile/src/components/preferences/connections/connection-auth.test.tsx`: add a Nintendo case next to Epic's: init opens the returned `authorizationUrl`, the pasted `npf5c38e31cd085304b://auth#session_token_code=...&state=...` link is sent as `callbackParams.code`, and a non-link input shows the invalid-code message.
- `apps/mobile/src/components/notifications/connection-reauth-notification.test.tsx` and `apps/mobile/src/components/importer/importer-screen.test.tsx`: add Nintendo cases mirroring the Epic ones.
