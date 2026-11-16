# Browser end-to-end verification

Date: 2026-11-16. Executed through the integrated T3 preview browser, with an isolated incognito session at 1280×800. The changed server checkout was rebuilt and served on localhost:5098; the changed client repository was served on localhost:3003. No API mocks were used.

## Passed scenarios

- General feed: 20 activity cards rendered through the existing pagination (two requests with limit 10). Cards included collection entries, reviews, posts, follow, platform achievement and game achievement activity types.
- Initial load: zero per-card profile, collection, review, post, game, statistics or detailed game achievement requests. One account profile request came from the application shell; authentication and notification requests also remained.
- Like/unlike: real browser clicks updated the count 0 → 1 → 0 and toggled the filled icon. Both mutations and the subsequent summary/status refetches returned HTTP 200.
- Viewer identity: detail fetched through the browser returned `isLiked: true` for the authenticated liker and `false` with credentials omitted.
- Privacy: the owner received the embedded private collection; an anonymous detail request received `collection: null`.
- Lazy game achievements: hovering the activity text issued exactly one `/v2/game/achievement/activity/89` request, HTTP 200, and rendered 18 achievement images in the popover. No detail request occurred on feed load.
- Following: clicking the Following tab navigated to `/activity/following`, fetched the corresponding feed with HTTP 200 and rendered 10 cards.
- Detail UI: `/activity/detail/:id` rendered one activity card, loaded its detail with HTTP 200, and made no statistics requests on render.

## Observations

- Next.js displayed its development overlay recommending a security update for version 16.4.3. It initially intercepted the click; dismissing it with Escape allowed the real browser interaction. Dependency upgrades were outside this test.
- React logged an unrecognized DOM prop warning for `openDelay` when opening achievement content.
- The console retained one `net::ERR_CONNECTION_TIMED_OUT` resource message. The retained network entries did not identify its URL. Verified API operations above returned HTTP 200; the achievement grid rendered.
- Local PostHog credentials were absent, so analytics was disabled.

## Limits and cleanup

This run covered the desktop web client in local development. Native Android/iOS and production deployment were not tested.

Temporary account, session, source activities, collections, entries, reviews, posts, follow and obtained-achievement records, and their statistics projections/events were removed after the run. The activity table returned to its original 115 rows. The browser tab and the three processes started for this test were closed.
