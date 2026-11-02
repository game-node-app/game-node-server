# MCP Tools Specification

## Purpose

Exposes a bounded set of GameNode actions (game discovery, library management, reviews and posts) as Model Context Protocol tools that AI assistants can call on a signed-in user's behalf.

## Requirements

### Requirement: Authenticated MCP endpoint
The API SHALL serve MCP over Streamable HTTP at `/v1/mcp` in stateless mode. Every request SHALL carry a bearer access token that is valid, unexpired, issued by GameNode and has audience `${DOMAIN_API}/v1/mcp`. Otherwise the API SHALL respond 401 with a `WWW-Authenticate` header pointing at the protected-resource metadata.

#### Scenario: Request without a token
- **WHEN** a client posts an MCP `initialize` request to `/v1/mcp` without `Authorization`
- **THEN** the response is HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="${DOMAIN_API}/.well-known/oauth-protected-resource/v1/mcp"`

#### Scenario: Token for another audience
- **WHEN** a client presents a GameNode-signed JWT whose `aud` is not the MCP resource
- **THEN** the response is HTTP 401

#### Scenario: Valid token lists tools
- **WHEN** a client with a valid token sends `tools/list`
- **THEN** the response lists the GameNode tools with JSON Schema input definitions and annotations marking which tools are read-only

### Requirement: Per-tool scopes
Each tool SHALL require one scope:
- `games:read` for `search_games` and `get_game`
- `library:read` for `get_library_entry` and `list_collections`
- `library:write` for `add_game_to_library`
- `reviews:write` for `review_game`
- `posts:write` for `create_post`

A call whose token lacks the scope SHALL be refused with HTTP 403 and an `insufficient_scope` challenge naming it.

#### Scenario: Missing write scope
- **WHEN** a client whose token holds only `games:read` calls `create_post`
- **THEN** the response is HTTP 403 with `WWW-Authenticate` error `insufficient_scope` and `scope="posts:write"`, and no post is created

### Requirement: Acting user identity
Every tool SHALL act as the user in the token's `sub` claim. No tool SHALL accept a user id as input.

#### Scenario: Library lookup uses the token's user
- **WHEN** user A's client calls `get_library_entry` for a game
- **THEN** the result reflects user A's library only

### Requirement: Locked-out users cannot write
Write tools SHALL refuse calls from users who are currently suspended or banned, returning a tool error that states the account is restricted. Read tools SHALL stay available to a suspended user while their token is valid.

#### Scenario: Suspended user posts
- **WHEN** a suspended user's client calls `create_post` with a valid token
- **THEN** the tool returns an error result and no post is created

### Requirement: Write rate limit
Write tools SHALL be limited to 10 calls per user per 60 seconds, counted across all write tools. Calls over the limit SHALL return a tool error that says the limit was reached and when to retry.

#### Scenario: Agent loops on posting
- **WHEN** a client calls `create_post` an 11th time within 60 seconds
- **THEN** the call returns a rate-limit tool error and no post is created

### Requirement: Input validation
Tool inputs SHALL be validated against their declared schema before any side effect. Invalid input SHALL return a tool error naming the invalid field, without changing any data.

#### Scenario: Rating out of range
- **WHEN** `review_game` is called with `rating: 7`
- **THEN** the tool returns a validation error for `rating` and no review is written

### Requirement: Search games tool
`search_games` SHALL accept a `query` of 1 to 256 characters, an optional `limit` of 1 to 20 (default 10) and an optional `page`. It SHALL return, for each match, the game id, name, first release year and platform names, using the same search engine as `/v1/search/games`.

#### Scenario: Search by title
- **WHEN** `search_games` is called with `query: "hollow knight"`
- **THEN** the result contains matching games with id, name, release year and platform names, ordered as the search API orders them

### Requirement: Game details tool
`get_game` SHALL accept a game `id` and return a compact summary. The summary SHALL contain id, name, summary, first release date, genres, platforms (id and name), cover image URL, GameNode review score and website URL. An unknown id SHALL return a not-found tool error.

#### Scenario: Known game
- **WHEN** `get_game` is called with an existing game id
- **THEN** the result includes the game's platforms with their ids, usable as `platform_ids` in `add_game_to_library`

#### Scenario: Unknown game
- **WHEN** `get_game` is called with an id that does not exist
- **THEN** the tool returns a not-found error

### Requirement: Library read tools
`get_library_entry` SHALL return the user's entry for a game (status, platforms, collections, favorite flag, dates), or state that the game is not in the library. `list_collections` SHALL return the user's collections (id, name, default status) so they can be named in `add_game_to_library`.

#### Scenario: Game not in library
- **WHEN** `get_library_entry` is called for a game the user has not added
- **THEN** the result states the game is not in the library

### Requirement: Add game to library tool
`add_game_to_library` SHALL accept `game_id`, `status` (`planned`, `playing`, `finished`, `dropped` or `ongoing`), `platform_ids` and optional `collection_ids`, then create or update the user's entry. Platform ids SHALL belong to the game. Collection ids SHALL belong to the user.

#### Scenario: New entry
- **WHEN** the tool is called for a game not in the library, with a status and one of the game's platforms
- **THEN** a library entry is created and the result reports it was created

#### Scenario: Existing entry keeps its collections
- **WHEN** the tool is called for a game already in two collections, with a new status and no `collection_ids`
- **THEN** the entry's status is updated and it remains in both collections

#### Scenario: Platform not available for the game
- **WHEN** `platform_ids` contains a platform the game was not released on
- **THEN** the tool returns a validation error and the library is unchanged

#### Scenario: Another user's collection
- **WHEN** `collection_ids` contains a collection owned by a different user
- **THEN** the tool returns an error and the library is unchanged

### Requirement: Review game tool
`review_game` SHALL accept `game_id`, a `rating` from 0 to 5, optional plain-text `content` of 4 to 10,000 characters, and `overwrite` (default false). The game SHALL already be in the user's library. If the user already reviewed it and `overwrite` is false, the tool SHALL refuse and return the existing review. This guard applies to the tool only. `POST /v1/reviews` SHALL keep its create-or-update behavior.

#### Scenario: First review
- **WHEN** the user has no review for the game and calls `review_game` with a rating and content
- **THEN** a review is created and appears in the game's reviews like a review written on the website

#### Scenario: Game not in library
- **WHEN** `review_game` is called for a game the user has not added to their library
- **THEN** the tool returns an error saying to add the game with `add_game_to_library` first, and no review is written

#### Scenario: Accidental overwrite prevented
- **WHEN** the user already reviewed the game and the tool is called without `overwrite: true`
- **THEN** the existing review is unchanged and the result contains it with a note that `overwrite: true` replaces it

#### Scenario: Explicit overwrite
- **WHEN** the user already reviewed the game and the tool is called with `overwrite: true`, a new rating and no `content`
- **THEN** the rating is updated and the existing content is kept, matching the website's update behavior

#### Scenario: Website review edits unaffected
- **WHEN** a website or mobile client posts `POST /v1/reviews` for a game the user already reviewed
- **THEN** the review is updated in place, as before this change

### Requirement: Create post tool
`create_post` SHALL accept `game_id` and plain-text `content` of 1 to 5,000 characters, and publish a post about that game on the user's profile and feeds. The result SHALL include the new post's id.

#### Scenario: Post about a game
- **WHEN** `create_post` is called with an existing game id and content
- **THEN** a post is created for the user and an activity is registered as for posts created on the website

#### Scenario: Unknown game
- **WHEN** `create_post` is called with a game id that does not exist
- **THEN** the tool returns a not-found error and no post is created

### Requirement: Plain-text content storage
Text written through MCP tools SHALL be treated as plain text. The text SHALL be HTML-escaped, and paragraphs separated by blank lines SHALL be wrapped in `<p>` elements before storage, so no markup supplied by a client is stored.

#### Scenario: Markup in content
- **WHEN** a post's content contains `<img src=x onerror=alert(1)>`
- **THEN** the stored post shows that text literally and contains no `img` element

#### Scenario: Paragraphs
- **WHEN** review content is `Great game.\n\nToo short.`
- **THEN** the stored content is `<p>Great game.</p><p>Too short.</p>`

### Requirement: Write tools are marked as such
Write tools SHALL be annotated `readOnlyHint: false`, and their descriptions SHALL state that they publish or change the user's GameNode data. This lets clients ask the user for confirmation. Read tools SHALL be annotated `readOnlyHint: true`.

#### Scenario: Client inspects annotations
- **WHEN** a client lists tools
- **THEN** `create_post`, `review_game` and `add_game_to_library` carry `readOnlyHint: false`, and the four read tools carry `readOnlyHint: true`
