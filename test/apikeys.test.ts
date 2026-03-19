import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex.setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a test user and return their userId. */
async function createUser(
  t: ReturnType<typeof convexTest>,
  email = "test@example.com",
) {
  return await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.userInsert, {
      data: { email, emailVerificationTime: Date.now() },
    });
  });
}

// ---------------------------------------------------------------------------
// key.create
// ---------------------------------------------------------------------------

test("key.create returns raw key starting with sk_", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const result = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "CI Pipeline",
      scopes: [],
    });
  });

  expect(result.raw).toMatch(/^sk_/);
  expect(result.keyId).toBeTruthy();
});

test("key.create with no scopes succeeds", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const result = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "No Scopes Key",
      scopes: [],
    });
  });

  expect(result.raw).toBeTruthy();
  expect(result.keyId).toBeTruthy();
});

test("key.create with freeform scopes stores them as-is", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const scopes = [
    { resource: "data", actions: ["read", "write"] },
    { resource: "admin", actions: ["*"] },
  ];

  const { keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Scoped Key",
      scopes,
    });
  });

  const record = await t.run(async (ctx) => {
    return await auth.key.get(ctx, keyId);
  });

  expect(record?.scopes).toEqual(scopes);
});

test("key.create with expiry stores expiresAt", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

  const { keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Expiring Key",
      scopes: [],
      expiresAt,
    });
  });

  const record = await t.run(async (ctx) => {
    return await auth.key.get(ctx, keyId);
  });

  expect(record?.expiresAt).toBe(expiresAt);
});

test("key.create with per-key rateLimit stores it", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);
  const rateLimit = { maxRequests: 100, windowMs: 60_000 };

  const { keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Rate Limited Key",
      scopes: [],
      rateLimit,
    });
  });

  const record = await t.run(async (ctx) => {
    return await auth.key.get(ctx, keyId);
  });

  expect(record?.rateLimit).toEqual(rateLimit);
});

// ---------------------------------------------------------------------------
// key.verify
// ---------------------------------------------------------------------------

test("key.verify with valid raw key returns userId keyId and scopes", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);
  const scopes = [{ resource: "data", actions: ["read"] }];

  const { raw, keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, { userId, name: "Test Key", scopes });
  });

  // Verify and evaluate scopes inside a single t.run to avoid serializing
  // the ScopeChecker (which contains a function).
  const result = await t.run(async (ctx) => {
    const verified = await auth.key.verify(ctx, raw);
    return {
      userId: verified.userId,
      keyId: verified.keyId,
      canDataRead: verified.scopes.can("data", "read"),
      canDataWrite: verified.scopes.can("data", "write"),
    };
  });

  expect(result.userId).toBe(userId);
  expect(result.keyId).toBe(keyId);
  expect(result.canDataRead).toBe(true);
  expect(result.canDataWrite).toBe(false);
});

test("key.verify with unknown key throws", async () => {
  const t = convexTest(schema);

  await expect(
    t.run(async (ctx) => {
      return await auth.key.verify(ctx, "sk_not_a_real_key_abc123");
    }),
  ).rejects.toThrow();
});

test("key.verify after revoke throws", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw, keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Revokable",
      scopes: [],
    });
  });

  await t.run(async (ctx) => {
    await auth.key.revoke(ctx, keyId);
  });

  await expect(
    t.run(async (ctx) => {
      return await auth.key.verify(ctx, raw);
    }),
  ).rejects.toThrow();
});

test("key.verify after expiry throws", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema);
  const userId = await createUser(t);
  const expiresAt = Date.now() + 1000;

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Short-lived Key",
      scopes: [],
      expiresAt,
    });
  });

  vi.advanceTimersByTime(2000);

  await expect(
    t.run(async (ctx) => {
      return await auth.key.verify(ctx, raw);
    }),
  ).rejects.toThrow();

  vi.useRealTimers();
});

test("key.verify rate limiting triggers after threshold", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Rate Limited",
      scopes: [],
      rateLimit: { maxRequests: 3, windowMs: 60_000 },
    });
  });

  // First three calls should succeed (verify + discard scopes inside run)
  for (let i = 0; i < 3; i++) {
    await t.run(async (ctx) => {
      const verified = await auth.key.verify(ctx, raw);
      return verified.userId;
    });
  }

  // Fourth call should be rate limited
  await expect(
    t.run(async (ctx) => {
      return await auth.key.verify(ctx, raw);
    }),
  ).rejects.toThrow();

  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// key.list
// ---------------------------------------------------------------------------

test("key.list returns only keys for the given userId", async () => {
  const t = convexTest(schema);
  const userId1 = await createUser(t, "user1@example.com");
  const userId2 = await createUser(t, "user2@example.com");

  await t.run(async (ctx) => {
    await auth.key.create(ctx, { userId: userId1, name: "Key A", scopes: [] });
    await auth.key.create(ctx, { userId: userId1, name: "Key B", scopes: [] });
    await auth.key.create(ctx, { userId: userId2, name: "Key C", scopes: [] });
  });

  const result = await t.run(async (ctx) => {
    return await auth.key.list(ctx, { where: { userId: userId1 } });
  });

  expect(result.items).toHaveLength(2);
  expect(result.items.every((k: any) => k.userId === userId1)).toBe(true);
});

test("key.list with revoked: false excludes revoked keys", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId } = await t.run(async (ctx) => {
    await auth.key.create(ctx, { userId, name: "Active Key", scopes: [] });
    return await auth.key.create(ctx, {
      userId,
      name: "To Revoke",
      scopes: [],
    });
  });

  await t.run(async (ctx) => {
    await auth.key.revoke(ctx, keyId);
  });

  const result = await t.run(async (ctx) => {
    return await auth.key.list(ctx, { where: { userId, revoked: false } });
  });

  expect(result.items).toHaveLength(1);
  expect(result.items[0].name).toBe("Active Key");
});

// ---------------------------------------------------------------------------
// key.get
// ---------------------------------------------------------------------------

test("key.get returns record without raw key", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId, raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, { userId, name: "Get Test", scopes: [] });
  });

  const record = await t.run(async (ctx) => {
    return await auth.key.get(ctx, keyId);
  });

  expect(record).not.toBeNull();
  expect(record?._id).toBe(keyId);
  expect(record?.userId).toBe(userId);
  expect(record?.name).toBe("Get Test");
  expect(record?.prefix).toMatch(/^sk_/);
  // Raw key must not be stored
  expect(JSON.stringify(record)).not.toContain(raw);
});

test("key.get after revoke still returns record with revoked: true", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Revoke Check",
      scopes: [],
    });
  });

  await t.run(async (ctx) => {
    await auth.key.revoke(ctx, keyId);
  });

  const record = await t.run(async (ctx) => {
    return await auth.key.get(ctx, keyId);
  });

  expect(record).not.toBeNull();
  expect(record?.revoked).toBe(true);
});

// ---------------------------------------------------------------------------
// key.revoke
// ---------------------------------------------------------------------------

test("key.revoke sets revoked flag and verify throws", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw, keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "To Revoke",
      scopes: [],
    });
  });

  await t.run(async (ctx) => {
    await auth.key.revoke(ctx, keyId);
  });

  const record = await t.run(async (ctx) => {
    return await auth.key.get(ctx, keyId);
  });

  expect(record?.revoked).toBe(true);

  await expect(
    t.run(async (ctx) => {
      return await auth.key.verify(ctx, raw);
    }),
  ).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// scopes.can
// ---------------------------------------------------------------------------

test("scopes.can returns true for exact resource and action match", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Scoped",
      scopes: [{ resource: "reports", actions: ["read", "export"] }],
    });
  });

  const checks = await t.run(async (ctx) => {
    const verified = await auth.key.verify(ctx, raw);
    return {
      reportsRead: verified.scopes.can("reports", "read"),
      reportsExport: verified.scopes.can("reports", "export"),
      reportsDelete: verified.scopes.can("reports", "delete"),
      usersRead: verified.scopes.can("users", "read"),
    };
  });

  expect(checks.reportsRead).toBe(true);
  expect(checks.reportsExport).toBe(true);
  expect(checks.reportsDelete).toBe(false);
  expect(checks.usersRead).toBe(false);
});

test("scopes.can wildcard action grants all actions on resource", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Wildcard Action",
      scopes: [{ resource: "data", actions: ["*"] }],
    });
  });

  const checks = await t.run(async (ctx) => {
    const verified = await auth.key.verify(ctx, raw);
    return {
      dataRead: verified.scopes.can("data", "read"),
      dataWrite: verified.scopes.can("data", "write"),
      dataDelete: verified.scopes.can("data", "delete"),
      adminRead: verified.scopes.can("admin", "read"),
    };
  });

  expect(checks.dataRead).toBe(true);
  expect(checks.dataWrite).toBe(true);
  expect(checks.dataDelete).toBe(true);
  expect(checks.adminRead).toBe(false);
});

test("scopes.can wildcard resource grants action on all resources", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Wildcard Resource",
      scopes: [{ resource: "*", actions: ["read"] }],
    });
  });

  const checks = await t.run(async (ctx) => {
    const verified = await auth.key.verify(ctx, raw);
    return {
      dataRead: verified.scopes.can("data", "read"),
      usersRead: verified.scopes.can("users", "read"),
      adminRead: verified.scopes.can("admin", "read"),
      dataWrite: verified.scopes.can("data", "write"),
    };
  });

  expect(checks.dataRead).toBe(true);
  expect(checks.usersRead).toBe(true);
  expect(checks.adminRead).toBe(true);
  expect(checks.dataWrite).toBe(false);
});

test("scopes.can full wildcard grants everything", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Full Access",
      scopes: [{ resource: "*", actions: ["*"] }],
    });
  });

  const checks = await t.run(async (ctx) => {
    const verified = await auth.key.verify(ctx, raw);
    return {
      anythingAnything: verified.scopes.can("anything", "anything"),
      dataDelete: verified.scopes.can("data", "delete"),
      adminImpersonate: verified.scopes.can("admin", "impersonate"),
    };
  });

  expect(checks.anythingAnything).toBe(true);
  expect(checks.dataDelete).toBe(true);
  expect(checks.adminImpersonate).toBe(true);
});

// ---------------------------------------------------------------------------
// auth.user.current / auth.user.require with API key fallback
// ---------------------------------------------------------------------------

test("auth.user.current returns userId from API key Bearer header", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Bearer Key",
      scopes: [],
    });
  });

  const resolved = await t.run(async (ctx) => {
    const request = new Request("https://example.com/api/data", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    return await auth.user.current(ctx, request);
  });

  expect(resolved).toBe(userId);
});

test("auth.user.current returns null with no session and no header", async () => {
  const t = convexTest(schema);

  const resolved = await t.run(async (ctx) => {
    const request = new Request("https://example.com/api/data");
    return await auth.user.current(ctx, request);
  });

  expect(resolved).toBeNull();
});

test("auth.user.current returns null with invalid Bearer key", async () => {
  const t = convexTest(schema);

  const resolved = await t.run(async (ctx) => {
    const request = new Request("https://example.com/api/data", {
      headers: { Authorization: "Bearer sk_not_a_real_key" },
    });
    return await auth.user.current(ctx, request);
  });

  expect(resolved).toBeNull();
});

test("auth.user.current returns null with revoked key", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw, keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, { userId, name: "Revoked", scopes: [] });
  });
  await t.run(async (ctx) => auth.key.revoke(ctx, keyId));

  const resolved = await t.run(async (ctx) => {
    const request = new Request("https://example.com/api/data", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    return await auth.user.current(ctx, request);
  });

  expect(resolved).toBeNull();
});

test("auth.user.require throws NOT_SIGNED_IN when unauthenticated", async () => {
  const t = convexTest(schema);

  await expect(
    t.run(async (ctx) => {
      const request = new Request("https://example.com/api/data");
      return await auth.user.require(ctx, request);
    }),
  ).rejects.toThrow();
});

test("auth.user.require returns userId with valid API key", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { raw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, { userId, name: "Required", scopes: [] });
  });

  const resolved = await t.run(async (ctx) => {
    const request = new Request("https://example.com/api/data", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    return await auth.user.require(ctx, request);
  });

  expect(resolved).toBe(userId);
});

// ---------------------------------------------------------------------------
// auth.key.rotate
// ---------------------------------------------------------------------------

test("key.rotate returns new raw key starting with sk_", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId: oldKeyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Rotate Me",
      scopes: [{ resource: "data", actions: ["read"] }],
    });
  });

  const { keyId: newKeyId, raw } = await t.run(async (ctx) => {
    return await auth.key.rotate(ctx, oldKeyId);
  });

  expect(raw).toMatch(/^sk_/);
  expect(newKeyId).not.toBe(oldKeyId);
});

test("key.rotate: old key verify throws after rotation", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId: oldKeyId, raw: oldRaw } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "To Rotate",
      scopes: [],
    });
  });

  await t.run(async (ctx) => auth.key.rotate(ctx, oldKeyId));

  await expect(
    t.run(async (ctx) => auth.key.verify(ctx, oldRaw)),
  ).rejects.toThrow();
});

test("key.rotate: new key verify succeeds with same userId", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId: oldKeyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Rotate",
      scopes: [{ resource: "reports", actions: ["read"] }],
    });
  });

  const { raw: newRaw } = await t.run(async (ctx) => {
    return await auth.key.rotate(ctx, oldKeyId);
  });

  const result = await t.run(async (ctx) => {
    const verified = await auth.key.verify(ctx, newRaw);
    return {
      userId: verified.userId,
      canReportsRead: verified.scopes.can("reports", "read"),
    };
  });

  expect(result.userId).toBe(userId);
  expect(result.canReportsRead).toBe(true);
});

test("key.rotate: new key inherits scopes and rateLimit", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);
  const scopes = [{ resource: "data", actions: ["write"] }];
  const rateLimit = { maxRequests: 50, windowMs: 60_000 };

  const { keyId: oldKeyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, {
      userId,
      name: "Config Key",
      scopes,
      rateLimit,
    });
  });

  const { keyId: newKeyId } = await t.run(async (ctx) => {
    return await auth.key.rotate(ctx, oldKeyId);
  });

  const record = await t.run(async (ctx) => auth.key.get(ctx, newKeyId));

  expect(record?.scopes).toEqual(scopes);
  expect(record?.rateLimit).toEqual(rateLimit);
});

test("key.rotate: rotating already-revoked key throws", async () => {
  const t = convexTest(schema);
  const userId = await createUser(t);

  const { keyId } = await t.run(async (ctx) => {
    return await auth.key.create(ctx, { userId, name: "Revoked", scopes: [] });
  });

  await t.run(async (ctx) => auth.key.revoke(ctx, keyId));

  await expect(
    t.run(async (ctx) => auth.key.rotate(ctx, keyId)),
  ).rejects.toThrow();
});
