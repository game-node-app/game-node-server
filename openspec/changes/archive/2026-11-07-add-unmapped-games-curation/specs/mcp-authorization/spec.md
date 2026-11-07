# Spec Delta

## MODIFIED Requirements

### Requirement: GameNode scopes
The server SHALL define `games:read`, `library:read`, `library:write`, `reviews:write`, `posts:write` and `mappings:write`, alongside `openid`, `profile` and `offline_access`. Issued tokens SHALL carry only scopes the user approved. Holding `mappings:write` SHALL NOT by itself grant access to any tool; the `mcp-mapping-tools` capability also requires the `ADMIN` role.

#### Scenario: User approves a subset
- **WHEN** a client requests `games:read posts:write` and the user approves
- **THEN** the issued access token's `scope` claim contains exactly the approved scopes

#### Scenario: Regular user approves the mappings scope
- **WHEN** a user without the `ADMIN` role approves a client requesting `mappings:write`
- **THEN** the token carries `mappings:write` and the user still cannot see or call any mapping tool
