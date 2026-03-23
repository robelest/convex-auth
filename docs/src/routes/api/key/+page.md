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

| Method   | Signature                                                             | Returns                     | Description                                                                       |
| -------- | --------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| `create` | `(ctx, { userId, name, scopes?, metadata?, rateLimit?, expiresAt? })` | `{ keyId, secret }`         | Creates a new API key. The raw `secret` (with `sk_` prefix) is returned once.     |
| `verify` | `(ctx, secret)`                                                       | `{ keyId, userId, scopes }` | Verifies a raw key string and returns the associated key record.                  |
| `list`   | `(ctx, { userId?, limit?, cursor? })`                                 | Paginated key list          | Lists keys for a user.                                                            |
| `get`    | `(ctx, keyId)`                                                        | `Doc<"keys">`               | Fetches a key document by ID (does not include the raw secret).                   |
| `update` | `(ctx, keyId, { name?, scopes?, metadata?, rateLimit? })`             | `void`                      | Updates key metadata, scopes, or rate limit.                                      |
| `revoke` | `(ctx, keyId)`                                                        | `void`                      | Revokes a key (soft delete — the key still exists but can no longer be verified). |
| `remove` | `(ctx, keyId)`                                                        | `void`                      | Permanently deletes a key.                                                        |
| `rotate` | `(ctx, keyId)`                                                        | `{ secret }`                | Generates a new secret for an existing key. The old secret stops working.         |

## Scopes

Keys can be scoped with fine-grained permissions. Use `scopes.can()` to check:

```ts
const { scopes } = await auth.key.verify(ctx, secret);

if (!scopes.can("documents:read")) {
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

const { userId, scopes } = await auth.key.verify(ctx, secret);
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
const { secret: newSecret } = await auth.key.rotate(ctx, keyId);
// The old secret is immediately invalid
```

### Metadata

Each key can carry an arbitrary `metadata` object for storing additional context
like environment, project, or team:

```ts
await auth.key.update(ctx, keyId, {
  metadata: { environment: "staging", project: "mobile-app" },
});
```
