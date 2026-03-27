import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import { roles } from "@convex/roles";
import schema from "@convex/schema";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex.setup";

test("auth component registers and serves public core functions", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.userInsert, {
      data: { email: "component-user@example.com" },
    });
  });

  const user = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.userGetById, { userId });
  });

  expect(user).not.toBeNull();
  expect(user?.email).toBe("component-user@example.com");
});

test("auth.member.inspect returns membership, roleIds, and grants", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.userInsert, {
      data: { email: "member-inspect@example.com" },
    });
  });

  const orgId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Acme Org",
      slug: "acme-org",
      type: "organization",
    });
  });

  await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.memberAdd, {
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
    return await ctx.runMutation(components.auth.public.userInsert, {
      data: { email: "invalid-role@example.com" },
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
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
