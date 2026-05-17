# Auth Contract Changes

The REST API for SuperTokens authentication remains mostly identical. The client-side will see differences in Error responses from `signInUpPOST`.

- `POST /auth/signinup`
  - Returns `GENERAL_ERROR` with custom messages for unverified emails or older conflicting accounts:
    - `"UNVERIFIED_EMAIL_CONFLICT"`: Email requires verification before linking.
    - `"DUPLICATE_LEGACY_ACCOUNTS"`: Prompt for manual merge required.
