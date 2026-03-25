---
title: auth.key
description: API key management — create, verify, rotate, and scope keys.
---

<svelte:head>

  <title>auth.key - convex-auth</title>
</svelte:head>

# auth.key

The `auth.key` namespace manages API keys. Keys are SHA-256 hashed before
storage and are prefixed with `sk_` by default. Each key can carry scoped
permissions and optional per-key rate limiting.

## Methods

| Method   | Signature                                                             | Returns                                                      | Description                                                                       |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `create` | `(ctx, { userId, name, scopes?, metadata?, rateLimit?, expiresAt? })` | `{ ok, keyId, secret }`                                      | Creates a new API key. The secret key (with `sk_` prefix) is returned once.       |
| `verify` | `(ctx, secret)`                                                       | `{ ok: true, keyId, userId, scopes } \| { ok: false, code }` | Verifies a secret key string. Returns a structured result instead of throwing.    |
| `list`   | `(ctx, { userId?, limit?, cursor? })`                                 | Paginated key list                                           | Lists keys for a user.                                                            |
| `get`    | `(ctx, keyId)`                                                        | `Doc<"keys">`                                                | Fetches a key document by ID (does not include the secret).                       |
| `update` | `(ctx, keyId, { name?, scopes?, metadata?, rateLimit? })`             | `{ ok, keyId }`                                              | Updates key metadata, scopes, or rate limit.                                      |
| `revoke` | `(ctx, keyId)`                                                        | `{ ok, keyId }`                                              | Revokes a key (soft delete — the key still exists but can no longer be verified). |
| `delete` | `(ctx, keyId)`                                                        | `{ ok, keyId }`                                              | Permanently deletes a key.                                                        |
| `rotate` | `(ctx, keyId)`                                                        | `{ ok: true, keyId, secret } \| { ok: false, code }`         | Generates a new secret for an existing key. Returns a structured result.          |

## Scopes

Keys can be scoped with fine-grained permissions. Use `scopes.can()` to check:

```ts
const result = await auth.key.verify(ctx, secret);

if (!result.ok) {
  throw new Error(`Key verification failed: ${result.code}`);
}

if (!result.scopes.can("documents:read")) {
  throw new Error("Insufficient permissions");
}
```

## Examples

### Create a key with scopes

```ts
const { keyId, secret } = await auth.key.create(ctx, {
  userId,
  name: "CI/CD Key",
  scopes: ["documents:read", "documents:write"],
  metadata: { environment: "production" },
});

// secret = "sk_abc123..." — show this to the user once
```

### Verify a key from a request

```ts
const authHeader = request.headers.get("Authorization");
const secret = authHeader?.replace("Bearer ", "");

if (!secret) {
  throw new Error("Missing API key");
}

const result = await auth.key.verify(ctx, secret);
if (!result.ok) {
  throw new Error(`Invalid API key: ${result.code}`);
}

const { userId, scopes } = result;
```

### Per-key rate limiting

```ts
const { keyId, secret } = await auth.key.create(ctx, {
  userId,
  name: "Rate-limited key",
  rateLimit: {
    maxRequests: 100,
    windowMs: 60_000, // 100 requests per minute
  },
});
```

### Rotate a key

```ts
const result = await auth.key.rotate(ctx, keyId);
if (!result.ok) {
  throw new Error(`Key rotation failed: ${result.code}`);
}
// result.secret is the new key; the old secret is immediately invalid
```

### Metadata

Each key can carry an arbitrary `metadata` object for storing additional context
like environment, project, or team:

```ts
await auth.key.update(ctx, keyId, {
  metadata: { environment: "staging", project: "mobile-app" },
});
```
