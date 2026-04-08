---
title: auth.account
description: Account management — link/unlink providers, passkeys, and TOTP.
---

<svelte:head>

  <title>auth.account - convex-auth</title>
</svelte:head>

# auth.account

The `auth.account` namespace manages the link between users and authentication
methods. A user can have multiple accounts (e.g. password + Google OAuth),
passkey credentials, and TOTP enrollments.

## Account methods

| Method   | Signature                          | Returns             | Description                                                                                                     |
| -------- | ---------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `create` | `(ctx, { userId, provider, ... })` | `{ account, user }` | Links a new authentication provider to a user and returns the created account plus resolved user.               |
| `update` | `(ctx, accountId, data)`           | `{ accountId }`     | Updates an existing account record.                                                                             |
| `delete` | `(ctx, accountId)`                 | `{ accountId }`     | Deletes an account link. Throws `ConvexError` with code `ACCOUNT_NOT_FOUND` or `INVALID_PARAMETERS` on failure. |

## Passkey methods

Manage WebAuthn passkey credentials. Requires `passkey()` in providers.

| Method          | Signature                | Returns             | Description                               |
| --------------- | ------------------------ | ------------------- | ----------------------------------------- |
| `listPasskeys`  | `(ctx, { userId })`      | `Doc<"passkeys">[]` | Lists all registered passkeys for a user. |
| `renamePasskey` | `(ctx, passkeyId, name)` | `{ passkeyId }`     | Renames a passkey credential.             |
| `deletePasskey` | `(ctx, passkeyId)`       | `{ passkeyId }`     | Deletes a passkey credential.             |

```ts
const passkeys = await auth.account.listPasskeys(ctx, { userId });
await auth.account.deletePasskey(ctx, passkeyId);
```

## TOTP methods

Manage TOTP two-factor authentication. Requires `totp()` in providers.

| Method       | Signature           | Returns          | Description                        |
| ------------ | ------------------- | ---------------- | ---------------------------------- |
| `listTotps`  | `(ctx, { userId })` | `Doc<"totps">[]` | Lists TOTP enrollments for a user. |
| `deleteTotp` | `(ctx, totpId)`     | `{ totpId }`     | Deletes a TOTP enrollment.         |

```ts
const totps = await auth.account.listTotps(ctx, { userId });
await auth.account.deleteTotp(ctx, totpId);
```

## Examples

### Delete an account

```ts
import { ConvexError } from "convex/values";

try {
  const { accountId } = await auth.account.delete(ctx, accountId);
} catch (error) {
  if (error instanceof ConvexError) {
    // error.data.code is "ACCOUNT_NOT_FOUND" or "INVALID_PARAMETERS"
    console.error(`Failed to delete account: ${error.data.code}`);
  }
  throw error;
}
```
