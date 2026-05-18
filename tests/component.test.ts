import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import { roles } from "@convex/roles";
import schema from "@convex/schema";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex/setup";

test("auth component registers and serves public core functions", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "component-user@example.com" },
    });
  });

  const user = await t.run(async (ctx) => {
    return (await ctx.runQuery(components.auth.user.get, { id: userId })) as any;
  });

  expect(user).not.toBeNull();
  expect(user?.email).toBe("component-user@example.com");
});

test("refresh token exchange mismatch does not delete supplied session", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "refresh-mismatch@example.com" },
    });
  });

  const [sessionA, sessionB] = await t.run(async (ctx) => {
    const first = await ctx.runMutation(components.auth.session.issue, {
      userId,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 60_000,
    });
    const second = await ctx.runMutation(components.auth.session.issue, {
      userId,
      sessionExpirationTime: Date.now() + 60_000,
      refreshTokenExpirationTime: Date.now() + 60_000,
    });
    return [first, second];
  });

  const exchanged = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.token.refresh.exchange, {
      refreshTokenId: sessionA.refreshTokenId!,
      sessionId: sessionB.sessionId,
      now: Date.now(),
      refreshTokenExpirationTime: Date.now() + 60_000,
      reuseWindowMs: 10_000,
    });
  });

  const stillExists = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.session.get, {
      sessionId: sessionB.sessionId,
    });
  });

  expect(exchanged).toBeNull();
  expect(stillExists?._id).toBe(sessionB.sessionId);
});

test("auth verifier lookups ignore expired verifiers", async () => {
  const t = convexTest(schema);

  const verifierId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.token.pkce.create, {
      signature: "expired-signature",
      expirationTime: Date.now() - 1,
    });
  });

  const byId = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.token.pkce.get, { id: verifierId });
  });
  const bySignature = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.token.pkce.get, {
      signature: "expired-signature",
    });
  });

  expect(byId).toBeNull();
  expect(bySignature).toBeNull();
});

test("auth.member.inspect returns membership, roleIds, and grants", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "member-inspect@example.com" },
    });
  });

  const orgId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Acme Org",
      slug: "acme-org",
      type: "organization",
    });
  });

  await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.member.create, {
      userId,
      groupId: orgId,
      roleIds: [roles.orgAdmin.id],
    });
  });

  const result = await t.run(async (ctx) => {
    return await auth.member.inspect(ctx, {
      userId,
      groupId: orgId,
    });
  });

  expect(result.membership).toBeTruthy();
  expect(result.membership?._id).toBeTruthy();
  expect(result.roleIds).toContain(roles.orgAdmin.id);
  expect(result.grants).toContain("projects.manage");
});

test("auth.member.require throws ConvexError on invalid role ids", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.user.create, {
      data: { email: "invalid-role@example.com" },
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.group.create, {
      name: "Role Test Org",
      slug: "role-test-org",
      type: "organization",
    });
  });

  await expect(
    t.run(async (ctx) => {
      return await auth.member.require(ctx, {
        userId,
        groupId,
        roleIds: ["missing-role"] as any,
        grants: ["projects.read"],
      });
    }),
  ).rejects.toThrow(ConvexError);
});
