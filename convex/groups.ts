import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import { auth } from "./auth/core";
import { authAction, authMutation, authQuery } from "./functions";
import {
  getPermissions,
  getUserRoleLabel,
  getUserSummaries,
  groupSummary,
  inviteSummary,
  memberSummary,
  permissionsValidator,
  projectSummary,
  toSlug,
  type GroupSummary,
  userSummary,
  validRoleIds,
} from "./shared";

export const checkEmailExists = authQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const result = await auth.user.list(ctx, {
      where: { email: args.email.trim().toLowerCase() },
      limit: 1,
    });
    return result.items.length > 0;
  },
});

export const getAuthProviders = query({
  args: {},
  returns: v.object({
    google: v.boolean(),
  }),
  handler: async () => {
    return {
      google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    };
  },
});

export const listMyGroups = authQuery({
  args: {},
  returns: v.array(
    v.object({
      groupId: v.string(),
      name: v.string(),
      roleIds: v.array(v.string()),
      userRoleLabel: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const memberships = await auth.member.list(ctx, {
      where: { userId: ctx.auth.userId },
      limit: 50,
      orderBy: "_creationTime",
      order: "asc",
    });
    // Batch-fetch every group doc in one component round-trip. Previously
    // this fanned out N `auth.group.get` RPCs (one per membership).
    const groupIds: string[] = memberships.items.map(
      (membership: (typeof memberships.items)[number]) => membership.groupId,
    );
    const groupDocs = await auth.group.get(ctx, groupIds);
    type ListGroupEntry = {
      groupId: string;
      name: string;
      roleIds: string[];
      userRoleLabel: string;
    };
    const groupsWithNulls: Array<ListGroupEntry | null> = memberships.items.map(
      (membership: (typeof memberships.items)[number], i: number) => {
        const group = groupDocs[i];
        return group
          ? {
              groupId: group._id,
              name: group.name,
              roleIds: membership.roleIds,
              userRoleLabel: getUserRoleLabel(membership.roleIds),
            }
          : null;
      },
    );
    return groupsWithNulls.filter((group): group is ListGroupEntry => group !== null);
  },
});

export const getDashboard = authQuery({
  args: {
    groupId: v.optional(v.string()),
  },
  returns: v.object({
    user: v.union(userSummary, v.null()),
    groups: v.array(groupSummary),
    selectedGroup: v.union(
      v.object({
        groupId: v.string(),
        name: v.string(),
        roleIds: v.array(v.string()),
        grants: v.array(v.string()),
        userRoleLabel: v.string(),
        projects: v.array(projectSummary),
        members: v.array(memberSummary),
        permissions: permissionsValidator,
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const { userId, user } = ctx.auth;
    const roots = await auth.group.list(ctx, {
      where: { isRoot: true },
      orderBy: "name",
      order: "asc",
      limit: 20,
    });

    // Resolve all root-group memberships in a single batched component
    // round-trip. Previously this fanned out N `auth.member.inspect` RPCs
    // (one per root group via `Promise.all`) — on an org with 20 root groups
    // that's 20 component crossings just to decide which workspaces to
    // list. The batched helper collapses them into one.
    const rootGroupIds = roots.items.map((group: (typeof roots.items)[number]) => group._id);
    const resolutions = await auth.member.inspect(ctx, {
      userId,
      groupIds: rootGroupIds,
    });
    const groupsWithNulls: Array<GroupSummary | null> = roots.items.map(
      (group: (typeof roots.items)[number], i: number) => {
        const resolution = resolutions[i]!;
        if (resolution.membership === null) return null;
        return {
          groupId: group._id,
          name: group.name,
          roleIds: resolution.roleIds,
          grants: resolution.grants,
        } satisfies GroupSummary;
      },
    );
    const groups: GroupSummary[] = groupsWithNulls.filter(
      (group): group is GroupSummary => group !== null,
    );

    if (groups.length === 0) {
      return {
        user: {
          userId,
          name: user?.name ?? user?.email ?? "Unknown user",
          email: user?.email ?? null,
        },
        groups: [],
        selectedGroup: null,
      };
    }

    const selectedGroup = groups.find((group) => group.groupId === args.groupId) ?? groups[0]!;
    const permissions = getPermissions(selectedGroup.grants);

    // Kick off the projects scan and the member-list component read at the
    // same time — neither depends on the other.
    const [projects, members] = await Promise.all([
      permissions.canReadProjects
        ? ctx.db
            .query("projects")
            .withIndex("by_groupId", (q) => q.eq("groupId", selectedGroup.groupId))
            .take(50)
        : Promise.resolve([]),
      auth.member.list(ctx, {
        where: { groupId: selectedGroup.groupId },
        limit: 20,
        orderBy: "_creationTime",
        order: "asc",
      }),
    ]);

    const projectSummaries = projects.map((project) => ({
      projectId: project._id,
      name: project.name,
      identifier: project.identifier,
      slug: project.slug,
      description: project.description,
      status: project.status,
      issueCount: project.issueCounter,
      openIssueCount: project.openIssueCount ?? 0,
    }));

    // Fetch every member's user doc in a single batched component round-trip
    // rather than firing N serial `auth.user.get` calls. With the batched
    // helper plus the ctx-scoped cache, the shared active-group member
    // summary (already resolved by `auth.ctx()`) also dedupes for free.
    const memberUserIds = members.items.map(
      (member: (typeof members.items)[number]) => member.userId,
    );
    const memberUserSummaries = await getUserSummaries(ctx, memberUserIds);
    const memberSummaries = members.items.map(
      (member: (typeof members.items)[number], i: number) => ({
        memberId: member._id,
        userId: member.userId,
        name: memberUserSummaries[i]!.name,
        email: memberUserSummaries[i]!.email,
        roleIds: member.roleIds ?? [],
        status: member.status ?? "active",
      }),
    );

    return {
      user: {
        userId,
        name: user?.name ?? user?.email ?? "Unknown user",
        email: user?.email ?? null,
      },
      groups,
      selectedGroup: {
        groupId: selectedGroup.groupId,
        name: selectedGroup.name,
        roleIds: selectedGroup.roleIds,
        grants: selectedGroup.grants,
        userRoleLabel: getUserRoleLabel(selectedGroup.roleIds),
        projects: projectSummaries,
        members: memberSummaries,
        permissions,
      },
    };
  },
});

export const createGroup = authMutation({
  args: { name: v.string() },
  returns: v.object({ groupId: v.string() }),
  handler: async (ctx, { name: rawName }) => {
    const { userId } = ctx.auth;
    const name = rawName.trim();
    if (name.length < 3) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Name must be at least 3 characters.",
      });
    }
    const { groupId } = await auth.group.create(ctx, {
      name,
      slug: toSlug(name),
    });
    await auth.member.create(ctx, {
      userId,
      groupId,
      roleIds: [validRoleIds[0]],
    });
    return { groupId };
  },
});

export const updateMemberRole = authMutation({
  args: {
    groupId: v.string(),
    memberId: v.string(),
    roleId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.groupId,
      grants: ["members.manage"],
    });

    const matched = validRoleIds.find((id) => id === args.roleId);
    if (!matched) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Invalid role.",
      });
    }

    if (matched !== validRoleIds[0]) {
      const members = await auth.member.list(ctx, {
        where: { groupId: args.groupId },
        limit: 50,
      });
      const adminCount = members.items.filter(
        (member: (typeof members.items)[number]) =>
          member.roleIds?.includes(validRoleIds[0]) && member._id !== args.memberId,
      ).length;
      if (adminCount === 0) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Cannot remove the last admin.",
        });
      }
    }

    await auth.member.update(ctx, args.memberId, {
      roleIds: [matched],
    });

    return null;
  },
});

export const createInviteInternal = internalMutation({
  args: {
    groupId: v.string(),
    email: v.string(),
    roleId: v.string(),
    invitedByUserId: v.string(),
  },
  returns: v.object({
    inviteId: v.string(),
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    await auth.member.require(ctx, {
      userId: args.invitedByUserId,
      groupId: args.groupId,
      grants: ["members.manage"],
    });

    const matched = validRoleIds.find((id) => id === args.roleId);
    if (!matched) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Invalid role.",
      });
    }

    const result = await auth.invite.create(ctx, {
      groupId: args.groupId,
      email: args.email,
      roleIds: [matched],
      invitedByUserId: args.invitedByUserId,
    });
    return {
      inviteId: result.inviteId,
      token: result.token,
    };
  },
});

export const inviteMember = authAction({
  args: {
    groupId: v.string(),
    email: v.string(),
    roleId: v.string(),
  },
  returns: v.object({ inviteId: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;
    const email = args.email.trim().toLowerCase();

    const result: { inviteId: string; token: string } = await ctx.runMutation(
      internal.groups.createInviteInternal,
      {
        groupId: args.groupId,
        email,
        roleId: args.roleId,
        invitedByUserId: userId,
      },
    );

    const appUrl = process.env.APP_URL ?? "http://localhost:3001";
    const inviteLink = `${appUrl}/?invite=${result.token}&email=${encodeURIComponent(email)}`;
    const from = process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>";

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: email,
          subject: "You've been invited to an organization",
          html: `<p>You've been invited to join an organization.</p><p><a href="${inviteLink}">Accept invitation</a></p>`,
        }),
      });
      if (!res.ok) {
        console.error("Invite email failed:", res.status);
      }
    } catch (error) {
      console.error("Invite email error:", error);
    }

    return { inviteId: result.inviteId };
  },
});

export const acceptInvite = authMutation({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.invite.token.accept(ctx, {
      token: args.token,
      acceptedByUserId: userId,
    });
    return null;
  },
});

export const listInvites = authQuery({
  args: {
    groupId: v.string(),
  },
  returns: v.array(inviteSummary),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.groupId,
      grants: ["members.manage"],
    });

    const result = await auth.invite.list(ctx, {
      where: { groupId: args.groupId, status: "pending" },
      orderBy: "_creationTime",
      order: "desc",
      limit: 20,
    });

    return result.items.map((invite: (typeof result.items)[number]) => ({
      inviteId: invite._id,
      email: invite.email ?? null,
      roleIds: invite.roleIds ?? [],
      createdAt: invite._creationTime,
    }));
  },
});

export const revokeInvite = authMutation({
  args: {
    groupId: v.string(),
    inviteId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.groupId,
      grants: ["members.manage"],
    });

    await auth.invite.revoke(ctx, args.inviteId);
    return null;
  },
});
