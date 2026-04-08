import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { auth } from "./auth";
import { authAction, authMutation, authQuery } from "./functions";
import {
  getPermissions,
  getUserRoleLabel,
  getUserSummary,
  groupSummary,
  inviteSummary,
  memberSummary,
  permissionsValidator,
  projectSummary,
  teamSummary,
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
        teams: v.array(teamSummary),
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

    const groups = (
      await Promise.all(
        roots.items.map(async (group: (typeof roots.items)[number]) => {
          const resolution = await auth.member.inspect(ctx, {
            userId,
            groupId: group._id,
          });
          if (resolution.membership === null) {
            return null;
          }
          return {
            groupId: group._id,
            name: group.name,
            roleIds: resolution.roleIds,
            grants: resolution.grants,
          } satisfies GroupSummary;
        }),
      )
    ).filter((group): group is GroupSummary => group !== null);

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

    const selectedGroup =
      groups.find((group) => group.groupId === args.groupId) ?? groups[0]!;
    const permissions = getPermissions(selectedGroup.grants);

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_groupId", (q) => q.eq("groupId", selectedGroup.groupId))
      .take(50);

    const projectSummaries = await Promise.all(
      projects.map(async (project) => {
        const teamGroup = project.teamGroupId
          ? await auth.group.get(ctx, project.teamGroupId)
          : null;
        return {
          projectId: project._id,
          name: project.name,
          identifier: project.identifier,
          slug: project.slug,
          description: project.description,
          status: project.status,
          teamGroupId: project.teamGroupId ?? null,
          teamName: teamGroup?.name ?? null,
          issueCount: project.issueCounter,
          openIssueCount: project.openIssueCount ?? 0,
        };
      }),
    );

    const teams = await auth.group.list(ctx, {
      where: { parentGroupId: selectedGroup.groupId },
      limit: 20,
      orderBy: "name",
      order: "asc",
    });
    const teamSummaries = await Promise.all(
      teams.items.map(async (team: (typeof teams.items)[number]) => {
        const children = await auth.group.list(ctx, {
          where: { parentGroupId: team._id },
          limit: 20,
          orderBy: "name",
          order: "asc",
        });
        return {
          groupId: team._id,
          name: team.name,
          type: team.type ?? "team",
          children: children.items.map((child: (typeof children.items)[number]) => ({
            groupId: child._id,
            name: child.name,
            type: child.type ?? "team",
          })),
        };
      }),
    );

    const members = await auth.member.list(ctx, {
      where: { groupId: selectedGroup.groupId },
      limit: 20,
      orderBy: "_creationTime",
      order: "asc",
    });
    const memberSummaries = await Promise.all(
      members.items.map(async (member: (typeof members.items)[number]) => {
        const summary = await getUserSummary(ctx, member.userId);
        return {
          memberId: member._id,
          userId: member.userId,
          name: summary.name,
          email: summary.email,
          roleIds: member.roleIds ?? [],
          status: member.status ?? "active",
        };
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
        teams: teamSummaries,
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
    const { groupId } = await auth.group.create(ctx, { name, slug: toSlug(name) });
    await auth.member.create(ctx, {
      userId,
      groupId,
      roleIds: [validRoleIds[0]],
    });
    return { groupId };
  },
});

export const createTeam = authMutation({
  args: {
    groupId: v.string(),
    name: v.string(),
    parentTeamId: v.optional(v.string()),
  },
  returns: v.object({ groupId: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;
    const teamName = args.name.trim();
    if (teamName.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Team name must be at least 2 characters.",
      });
    }

    await auth.member.require(ctx, {
      userId,
      groupId: args.groupId,
      grants: ["teams.manage"],
    });

    const { groupId } = await auth.group.create(ctx, {
      name: teamName,
      parentGroupId: args.parentTeamId ?? args.groupId,
      type: "team",
      tags: [{ key: "demo", value: "team" }],
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
