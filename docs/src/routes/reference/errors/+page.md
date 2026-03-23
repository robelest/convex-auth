---
title: Error Codes
description: Structured error codes returned by convex-auth.
---

<svelte:head>

  <title>Error Codes - convex-auth</title>
</svelte:head>

# Error Codes

All errors are `ConvexError` instances with `{ code, message }`. Use
`isAuthError(error)` or `parseAuthError(error)` to detect and parse them.

```ts
import { isAuthError, parseAuthError } from "@robelest/convex-auth/errors";

try {
  await auth.user.require(ctx);
} catch (e) {
  if (isAuthError(e)) {
    const { code, message } = parseAuthError(e)!;
    // code: "NOT_SIGNED_IN"
  }
}
```

## Auth errors

| Code                      | Description                      |
| ------------------------- | -------------------------------- |
| `NOT_SIGNED_IN`           | No valid session or API key      |
| `FORBIDDEN`               | Authenticated but not authorized |
| `ACCOUNT_NOT_FOUND`       | Account does not exist           |
| `USER_NOT_FOUND`          | User does not exist              |
| `INVALID_PARAMETERS`      | Bad input arguments              |
| `INTERNAL_ERROR`          | Unexpected server error          |
| `PROVIDER_NOT_CONFIGURED` | Provider not in config           |

## API key errors

| Code                   | Description                       |
| ---------------------- | --------------------------------- |
| `MISSING_BEARER_TOKEN` | No/malformed Authorization header |
| `INVALID_API_KEY`      | Key not found                     |
| `API_KEY_REVOKED`      | Key has been revoked              |
| `API_KEY_EXPIRED`      | Key past expiration               |
| `API_KEY_RATE_LIMITED` | Per-key rate limit exceeded       |
| `SCOPE_CHECK_FAILED`   | Key lacks required scope          |

## Invite errors

| Code                   | Description                     |
| ---------------------- | ------------------------------- |
| `DUPLICATE_MEMBERSHIP` | User is already a member        |
| `DUPLICATE_INVITE`     | Invite already exists           |
| `INVITE_NOT_FOUND`     | Invite does not exist           |
| `INVITE_NOT_PENDING`   | Invite is not in pending status |
| `NO_ACTIVE_GROUP`      | No active group set             |

## Device flow errors

| Code                             | Description                      |
| -------------------------------- | -------------------------------- |
| `DEVICE_AUTHORIZATION_PENDING`   | User hasn't entered the code yet |
| `DEVICE_SLOW_DOWN`               | Polling too fast                 |
| `DEVICE_CODE_EXPIRED`            | Code expired                     |
| `DEVICE_CODE_INVALID`            | Code not found or already used   |
| `DEVICE_CODE_DENIED`             | Authorization explicitly denied  |
| `DEVICE_CODE_ALREADY_AUTHORIZED` | Code already authorized          |
