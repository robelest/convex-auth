/**
 * Tests for the lifecycle-aware deletion helpers exposed on
 * `ctx.auth.{passkey.delete, totp.delete, account.unlink}`.
 *
 * Each helper reads the target document, runs the corresponding component
 * mutation, and fires the matching `after` lifecycle event. These tests
 * exercise the underlying component mutations directly to verify the
 * deletion + supporting state transitions (e.g. `User.hasTotp`) behave
 * correctly. The runtime wrapper that fires the lifecycle event is
 * type-asserted in `consumer/callbacks.ts` and exercised
 * end-to-end by provider-level tests.
 */

import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("passkeyDelete removes the passkey row", async () => {
  const t = convexTest(schema);

  const { userId, passkeyId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "passkey-delete@example.com" },
    })) as string;
    const passkeyId = await ctx.runMutation(components.auth.public.passkeyInsert, {
      userId: userId as never,
      credentialId: "test-credential-passkey-delete",
      publicKey: new ArrayBuffer(32),
      algorithm: -7,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: Date.now(),
    });
    return { userId, passkeyId };
  });

  const before = await t.run((ctx) =>
    ctx.runQuery(components.auth.public.passkeyGetById, { passkeyId }),
  );
  expect(before).not.toBeNull();
  expect(before?.userId).toBe(userId);

  await t.run((ctx) => ctx.runMutation(components.auth.public.passkeyDelete, { passkeyId }));

  const after = await t.run((ctx) =>
    ctx.runQuery(components.auth.public.passkeyGetById, { passkeyId }),
  );
  expect(after).toBeNull();
});

test("totpDelete clears User.hasTotp when no verified factors remain", async () => {
  const t = convexTest(schema);

  const { userId, totpId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "totp-delete@example.com" },
    })) as string;
    const secret = new ArrayBuffer(20);
    const totpId = await ctx.runMutation(components.auth.public.totpInsert, {
      userId: userId as never,
      secret,
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.public.totpMarkVerified, {
      totpId,
      lastUsedAt: Date.now(),
    });
    return { userId, totpId };
  });

  const userBefore = await t.run((ctx) =>
    ctx.runQuery(components.auth.user.get, { id: userId }),
  );
  expect(userBefore?.hasTotp).toBe(true);

  await t.run((ctx) => ctx.runMutation(components.auth.public.totpDelete, { totpId }));

  const userAfter = await t.run((ctx) =>
    ctx.runQuery(components.auth.user.get, { id: userId }),
  );
  expect(userAfter?.hasTotp).toBe(false);

  const totpDoc = await t.run((ctx) =>
    ctx.runQuery(components.auth.public.totpGetById, { totpId }),
  );
  expect(totpDoc).toBeNull();
});

test("totpDelete keeps hasTotp true when another verified factor exists", async () => {
  const t = convexTest(schema);

  const { userId, firstTotpId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "totp-multi@example.com" },
    })) as string;
    const firstTotpId = await ctx.runMutation(components.auth.public.totpInsert, {
      userId: userId as never,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.public.totpMarkVerified, {
      totpId: firstTotpId,
      lastUsedAt: Date.now(),
    });
    const secondTotpId = await ctx.runMutation(components.auth.public.totpInsert, {
      userId: userId as never,
      secret: new ArrayBuffer(20),
      digits: 6,
      period: 30,
      verified: false,
      createdAt: Date.now(),
    });
    await ctx.runMutation(components.auth.public.totpMarkVerified, {
      totpId: secondTotpId,
      lastUsedAt: Date.now(),
    });
    return { userId, firstTotpId };
  });

  await t.run((ctx) =>
    ctx.runMutation(components.auth.public.totpDelete, { totpId: firstTotpId }),
  );

  const user = await t.run((ctx) =>
    ctx.runQuery(components.auth.user.get, { id: userId }),
  );
  expect(user?.hasTotp).toBe(true);
});

test("accountDelete removes the account row", async () => {
  const t = convexTest(schema);

  const { accountId } = await t.run(async (ctx) => {
    const userId = (await ctx.runMutation(components.auth.user.create, {
      data: { email: "account-unlink@example.com" },
    })) as string;
    const accountId = await ctx.runMutation(components.auth.account.create, {
      userId: userId as never,
      provider: "google",
      providerAccountId: "google-1234",
    });
    return { userId, accountId };
  });

  const before = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.get, { id: accountId }),
  );
  expect(before).not.toBeNull();
  expect(before?.provider).toBe("google");

  await t.run((ctx) => ctx.runMutation(components.auth.account.delete, { accountId }));

  const after = await t.run((ctx) =>
    ctx.runQuery(components.auth.account.get, { id: accountId }),
  );
  expect(after).toBeNull();
});
