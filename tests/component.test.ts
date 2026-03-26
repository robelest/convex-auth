import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import { roles } from "@convex/roles";
import schema from "@convex/schema";
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

test("auth.member.resolve handles direct grants and inherited memberships", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.userInsert, {
      data: { email: "member-resolve@example.com" },
    });
  });

  const orgId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Acme Org",
      slug: "acme-org",
      type: "organization",
    });
  });

  const teamId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Platform Team",
      slug: "platform-team",
      type: "team",
      parentGroupId: orgId,
    });
  });

  await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.memberAdd, {
      userId,
      groupId: orgId,
      roleIds: [roles.orgAdmin.id],
    });
  });

  const direct = await t.run(async (ctx) => {
    return await auth.member.resolve(ctx, {
      userId,
      groupId: orgId,
      grants: ["projects.manage"],
    });
  });

  expect(direct.ok).toBe(true);
  expect(direct.membership?._id).toBeTruthy();
  expect(direct.isDirect).toBe(true);
  expect(direct.isInherited).toBe(false);
  expect(direct.matchedGroupId).toBe(orgId);
  expect(direct.grants).toContain("projects.manage");
  expect(direct.missingGrants).toEqual([]);

  const inherited = await t.run(async (ctx) => {
    return await auth.member.resolve(ctx, {
      userId,
      groupId: teamId,
      ancestry: true,
      grants: ["projects.manage"],
    });
  });

  expect(inherited.ok).toBe(true);
  expect(inherited.membership?._id).toBeTruthy();
  expect(inherited.isDirect).toBe(false);
  expect(inherited.isInherited).toBe(true);
  expect(inherited.matchedGroupId).toBe(orgId);
  expect(inherited.depth).toBe(1);
  expect(inherited.traversedGroupIds).toContain(teamId);
  expect(inherited.traversedGroupIds).toContain(orgId);
  expect(inherited.grants).toContain("projects.manage");
});

test("auth.member.resolve reports invalid role ids in a normalized shape", async () => {
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

  const result = await t.run(async (ctx) => {
    const invalidRoleArgs = {
      userId,
      groupId,
      roleIds: ["missing-role"],
      grants: ["projects.read"],
    } as unknown as Parameters<typeof auth.member.resolve>[1];

    return await auth.member.resolve(ctx, invalidRoleArgs);
  });

  expect(result.ok).toBe(false);
  expect(result.code).toBe("INVALID_ROLE_IDS");
  expect(result.invalidRoleIds).toEqual(["missing-role"]);
  expect(result.membership).toBeNull();
  expect(result.matchedGroupId).toBeNull();
  expect(result.roleIds).toEqual([]);
  expect(result.grants).toEqual([]);
  expect(result.missingGrants).toEqual(["projects.read"]);
});
