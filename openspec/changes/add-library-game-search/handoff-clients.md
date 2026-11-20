# Library game search

Implement the search box in a separate change in `game-node-clients`. Regenerate the client from
`server_swagger.json` before updating the library, favorites and collection views.

## Contract

### Search on entry listings

| Route | Where to send `search` |
| --- | --- |
| `GET /v1/collections-entries/library/{id}` | Query string |
| `GET /v1/collections-entries/library/{userId}/favorites` | Query string |
| `POST /v1/collections-entries/collection/{id}` | Top-level property of the JSON body |

All three routes accept an optional string of up to 256 characters. Omit the field or send an empty
or whitespace-only string within the limit to use the usual listing. A nonblank string that
normalizes to empty, such as `'`, `%%%` or `_`, returns an empty page.

On the GET routes, send `?search=halo&offset=0&limit=20`. On the collection POST, send this body.

```json
{ "search": "halo", "offset": 0, "limit": 20 }
```

| Status | When |
| --- | --- |
| 200 | Page of matching visible entries. A hidden library or collection, or a search with zero visible matches, returns `data: []` and `pagination.totalItems: 0`. |
| 400 | A non-string value, including JSON `null`, or a string longer than 256 characters. The API rejects the request before querying entries. |

The routes are public and accept an optional Better Auth session. Hidden entries are omitted from
both the page and its totals. Anonymous viewers get the usual visibility rules.

### Matching rules

A match is a contiguous substring of the normalized title or one normalized alternative name.
Matching ignores case and Latin accents, removes apostrophes, and collapses runs of other
punctuation, symbols and whitespace into a space. Names in the response keep their original spelling.

| Input | Example result |
| --- | --- |
| `halo` | Halo 3 and Halo Infinite when both entries are visible in the listing |
| `minec` | Minecraft |
| `botw` | The Legend of Zelda: Breath of the Wild via its alternative name BOTW |
| `Assassin's Creed`, `Assassin’s Creed`, `assassins creed` | Assassin's Creed |
| `POKEMON LETS GO`, `pokémon`, `Poke` followed by a combining acute accent and `mon` | Pokémon: Let's Go, Pikachu! |
| `half life 2`, `half-life` | Half-Life 2 |
| `life half` | An empty result when the listing contains only Half-Life games |
| `100%` | 100% Orange Juice via the normalized text `100` |
| `' OR 1=1 --` | A title or alias containing the normalized text `OR 1 1` |

The search checks each title or alias separately. It uses literal normalized text and scopes matches
to entries in the target library, favorites, or collection. Newly added entries are searchable
immediately through the listing.

### Filters and pagination

| Option | Library | Favorites | Collection |
| --- | --- | --- | --- |
| `status` | Applied | Applied | Ignored |
| `gameFilters` | Defaults to main games, remasters and remakes | Ignored | Same default categories as the library |
| `hasCustomCover` | Applied | Applied | Applied |
| `orderBy.addedDate` | Date added to library | Date added to library | Date added to collection |
| `orderBy.releaseDate` | Game release date | Game release date | Game release date |
| `orderBy.userCustom` | Ignored | Ignored | Custom order within the collection |

To include matching DLCs in the library or a collection, request categories that include DLCs.
Supply `offset` and `limit` explicitly. The DTO defaults to 0 and 20. The existing pagination
interceptor uses 10 to compute page metadata when `limit` is omitted. With 25 visible matches,
`orderBy[addedDate]=DESC`, `offset=20` and `limit=20`, the library returns the five oldest matches
with `pagination.totalItems: 25`. The response schema is `CollectionEntriesPaginatedResponseDto`.

## Regenerating the client

1. Copy `server_swagger.json` into `packages/wrapper/input/server_swagger.json` in `game-node-clients`
   and run `pnpm wrapper:generate` there.
2. Check every call to `collectionsEntriesControllerFindAllByLibraryIdV1` and
   `collectionsEntriesControllerFindFavoritesByLibraryIdV1`. The new second positional argument
   is `search`, immediately after the ID, which shifts `orderBy` through `offset` and `limit`.
   The current callers are `useCollectionEntriesForUserId.ts` and
   `useFavoriteCollectionEntriesForUserId.ts` in
   `packages/ui/src/components/collection/collection-entry/hooks/`. Update their test mocks too.
3. Pass the collection search as `requestBody.search` to
   `collectionsEntriesControllerFindAllByCollectionIdV1`.

## Client work

- Add a search input to the library, favorites and collection views with a debounce of about 300 ms.
- Include the debounced search text in each React Query key. Reset the offset to 0 when the text
  changes, and clear the search when the library owner changes.
- Keep the previous page visible while the next request loads. When a search yields zero matches,
  show a no-results state with a clear action. Use the existing empty-library state when the
  unfiltered library is empty.
- Render the server results directly, including matches on aliases absent from the card. Handle
  invalid input as a request error and keep the existing visibility states for successful responses.
