import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { auth } from "./auth";
import { authAction, authMutation, authQuery } from "./functions";
import { roles } from "./roles";
import {
  demoIssueStatus as issueStatusValidator,
  demoIssuePriority as issuePriorityValidator,
} from "./schema";

// ── Shared return validators ──

const userSummary = v.object({
  userId: v.string(),
  name: v.string(),
  email: v.union(v.string(), v.null()),
});

const workspaceSummary = v.object({
  groupId: v.string(),
  name: v.string(),
  roleIds: v.array(v.string()),
  grants: v.array(v.string()),
});

const projectSummary = v.object({
  projectId: v.id("demoProjects"),
  name: v.string(),
  identifier: v.string(),
  slug: v.string(),
  description: v.string(),
  status: v.string(),
  teamGroupId: v.union(v.string(), v.null()),
  teamName: v.union(v.string(), v.null()),
  issueCount: v.number(),
  openIssueCount: v.number(),
});

const teamSummary = v.object({
  groupId: v.string(),
  name: v.string(),
  type: v.string(),
  children: v.array(
    v.object({
      groupId: v.string(),
      name: v.string(),
      type: v.string(),
    }),
  ),
});

const memberSummary = v.object({
  memberId: v.string(),
  userId: v.string(),
  name: v.string(),
  email: v.union(v.string(), v.null()),
  roleIds: v.array(v.string()),
  status: v.string(),
});

const permissionsValidator = v.object({
  canReadProjects: v.boolean(),
  canCreateProjects: v.boolean(),
  canManageProjects: v.boolean(),
  canCreateIssues: v.boolean(),
  canEditIssues: v.boolean(),
  canMoveIssues: v.boolean(),
  canAssignIssues: v.boolean(),
  canDeleteIssues: v.boolean(),
  canCreateComments: v.boolean(),
  canDeleteComments: v.boolean(),
  canManageTeams: v.boolean(),
  canManageMembers: v.boolean(),
  canManageSso: v.boolean(),
  canManageScim: v.boolean(),
});

const issueSummary = v.object({
  issueId: v.id("demoIssues"),
  identifier: v.string(),
  number: v.number(),
  title: v.string(),
  description: v.string(),
  status: v.string(),
  priority: v.string(),
  labels: v.array(v.string()),
  assigneeName: v.union(v.string(), v.null()),
  assigneeUserId: v.union(v.string(), v.null()),
  createdByName: v.string(),
  createdByUserId: v.string(),
});

const commentSummary = v.object({
  commentId: v.id("demoComments"),
  authorName: v.string(),
  authorUserId: v.string(),
  body: v.string(),
  createdAt: v.number(),
});

const inviteSummary = v.object({
  inviteId: v.string(),
  email: v.union(v.string(), v.null()),
  roleIds: v.array(v.string()),
  createdAt: v.number(),
});

type WorkspaceSummary = {
  groupId: string;
  name: string;
  roleIds: string[];
  grants: string[];
};

function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// ── Queries ──

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

export const dashboard = authQuery({
  args: {
    workspaceId: v.optional(v.string()),
  },
  returns: v.object({
    user: v.union(userSummary, v.null()),
    workspaces: v.array(workspaceSummary),
    selectedWorkspace: v.union(
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

    const workspaces = (
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
          } satisfies WorkspaceSummary;
        }),
      )
    ).filter((workspace) => workspace !== null);

    const getUserSummary = async (userId: string) => {
      const user = await auth.user.get(ctx, userId);
      return {
        userId,
        name: user?.name ?? user?.email ?? "Unknown user",
        email: user?.email ?? null,
        image: user?.image ?? null,
      };
    };

    if (workspaces.length === 0) {
      return {
        user: {
          userId,
          name: user?.name ?? user?.email ?? "Unknown user",
          email: user?.email ?? null,
        },
        workspaces: [],
        selectedWorkspace: null,
      };
    }

    const selectedWorkspace =
      workspaces.find((workspace) => workspace.groupId === args.workspaceId) ??
      workspaces[0];

    // Derive permissions from already-resolved grants (avoids 14 redundant DB reads)
    const { grants } = selectedWorkspace;
    const permissions = {
      canReadProjects: grants.includes("projects.read"),
      canCreateProjects: grants.includes("projects.create"),
      canManageProjects: grants.includes("projects.manage"),
      canCreateIssues: grants.includes("issues.create"),
      canEditIssues: grants.includes("issues.edit"),
      canMoveIssues: grants.includes("issues.move"),
      canAssignIssues: grants.includes("issues.assign"),
      canDeleteIssues: grants.includes("issues.delete"),
      canCreateComments: grants.includes("comments.create"),
      canDeleteComments: grants.includes("comments.delete"),
      canManageTeams: grants.includes("teams.manage"),
      canManageMembers: grants.includes("members.manage"),
      canManageSso: grants.includes("sso.connection.manage"),
      canManageScim: grants.includes("scim.manage"),
    };

    // Projects
    const projects = await ctx.db
      .query("demoProjects")
      .withIndex("by_groupId", (q) =>
        q.eq("groupId", selectedWorkspace.groupId),
      )
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

    // Teams
    const teams = await auth.group.list(ctx, {
      where: { parentGroupId: selectedWorkspace.groupId },
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
          children: children.items.map(
            (child: (typeof children.items)[number]) => ({
              groupId: child._id,
              name: child.name,
              type: child.type ?? "team",
            }),
          ),
        };
      }),
    );

    // Members
    const members = await auth.member.list(ctx, {
      where: { groupId: selectedWorkspace.groupId },
      limit: 20,
      orderBy: "_creationTime",
      order: "asc",
    });
    const memberSummaries = await Promise.all(
      members.items.map(async (member: (typeof members.items)[number]) => {
        const summary = await getUserSummary(member.userId);
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

    // Resolve user's effective role label for display
    const userRoleIds = selectedWorkspace.roleIds;
    let userRoleLabel = "Viewer";
    if (userRoleIds.includes(roles.orgAdmin.id)) {
      userRoleLabel = "Admin";
    } else if (userRoleIds.includes(roles.member.id)) {
      userRoleLabel = "Member";
    }

    return {
      user: {
        userId,
        name: user?.name ?? user?.email ?? "Unknown user",
        email: user?.email ?? null,
      },
      workspaces,
      selectedWorkspace: {
        groupId: selectedWorkspace.groupId,
        name: selectedWorkspace.name,
        roleIds: selectedWorkspace.roleIds,
        grants: selectedWorkspace.grants,
        userRoleLabel,
        projects: projectSummaries,
        teams: teamSummaries,
        members: memberSummaries,
        permissions,
      },
    };
  },
});

export const projectIssues = authQuery({
  args: {
    projectId: v.id("demoProjects"),
  },
  returns: v.object({
    project: v.union(
      v.object({
        projectId: v.id("demoProjects"),
        name: v.string(),
        identifier: v.string(),
        description: v.string(),
        teamName: v.union(v.string(), v.null()),
        teamGroupId: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
    issues: v.array(issueSummary),
  }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Project not found.",
      });
    }

    const scopeGroupId = project.teamGroupId ?? project.groupId;
    await auth.member.require(ctx, {
      userId,
      groupId: scopeGroupId,
      grants: ["projects.read"],
    });

    const teamGroup = project.teamGroupId
      ? await auth.group.get(ctx, project.teamGroupId)
      : null;

    const issues = await ctx.db
      .query("demoIssues")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(200);

    const getUserSummary = async (userId: string) => {
      const user = await auth.user.get(ctx, userId);
      return {
        userId,
        name: user?.name ?? user?.email ?? "Unknown user",
        email: user?.email ?? null,
        image: user?.image ?? null,
      };
    };

    const assigneeMap = new Map<
      string,
      {
        userId: string;
        name: string;
        email: string | null;
        image: string | null;
      }
    >();
    const creatorMap = new Map<
      string,
      {
        userId: string;
        name: string;
        email: string | null;
        image: string | null;
      }
    >();

    for (const issue of issues) {
      if (issue.assigneeUserId && !assigneeMap.has(issue.assigneeUserId)) {
        assigneeMap.set(
          issue.assigneeUserId,
          await getUserSummary(issue.assigneeUserId),
        );
      }
      if (!creatorMap.has(issue.createdByUserId)) {
        creatorMap.set(
          issue.createdByUserId,
          await getUserSummary(issue.createdByUserId),
        );
      }
    }

    const issueSummaries = issues
      .sort((a, b) => a.position - b.position)
      .map((issue) => ({
        issueId: issue._id,
        identifier: `${project.identifier}-${issue.number}`,
        number: issue.number,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
        labels: issue.labels ?? [],
        assigneeName: issue.assigneeUserId
          ? (assigneeMap.get(issue.assigneeUserId)?.name ?? null)
          : null,
        assigneeUserId: issue.assigneeUserId ?? null,
        createdByName: creatorMap.get(issue.createdByUserId)?.name ?? "Unknown",
        createdByUserId: issue.createdByUserId,
      }));

    return {
      project: {
        projectId: project._id,
        name: project.name,
        identifier: project.identifier,
        description: project.description,
        teamName: teamGroup?.name ?? null,
        teamGroupId: project.teamGroupId ?? null,
      },
      issues: issueSummaries,
    };
  },
});

export const issueComments = authQuery({
  args: {
    issueId: v.id("demoIssues"),
  },
  returns: v.array(commentSummary),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const issue = await ctx.db.get(args.issueId);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

    await auth.member.require(ctx, {
      userId,
      groupId: issue.scopeGroupId,
      grants: ["projects.read"],
    });

    const comments = await ctx.db
      .query("demoComments")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
      .take(100);

    const getUserSummary = async (userId: string) => {
      const user = await auth.user.get(ctx, userId);
      return {
        userId,
        name: user?.name ?? user?.email ?? "Unknown user",
        email: user?.email ?? null,
        image: user?.image ?? null,
      };
    };

    const summaries = await Promise.all(
      comments.map(async (comment) => {
        const authorSummary = await getUserSummary(comment.authorUserId);
        return {
          commentId: comment._id,
          authorName: authorSummary.name,
          authorUserId: comment.authorUserId,
          body: comment.body,
          createdAt: comment._creationTime,
        };
      }),
    );

    return summaries;
  },
});

// ── Mutations ──

export const createWorkspace = authMutation({
  args: {
    name: v.string(),
  },
  returns: v.object({ workspaceId: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;
    const name = args.name.trim();
    if (name.length < 3) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Workspace name must be at least 3 characters.",
      });
    }

    const roots = await auth.group.list(ctx, {
      where: { isRoot: true },
      orderBy: "name",
      order: "asc",
      limit: 20,
    });

    const existing = (
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
          } satisfies WorkspaceSummary;
        }),
      )
    ).filter((workspace) => workspace !== null);

    if (
      existing.some(
        (workspace) => workspace.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "You already have a workspace with that name.",
      });
    }

    const slugBase = toSlug(name);
    const { groupId } = await auth.group.create(ctx, {
      name,
      slug: slugBase,
      type: "workspace",
    });
    await auth.member.create(ctx, {
      userId,
      groupId,
      roleIds: [roles.orgAdmin.id],
    });

    return { workspaceId: groupId };
  },
});

export const createProject = authMutation({
  args: {
    workspaceId: v.string(),
    teamGroupId: v.optional(v.string()),
    name: v.string(),
    identifier: v.string(),
    description: v.string(),
  },
  returns: v.object({ projectId: v.id("demoProjects") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.workspaceId,
      grants: ["projects.create"],
    });

    const identifier = args.identifier
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (identifier.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Identifier must be at least 2 characters.",
      });
    }

    // Check identifier uniqueness within workspace
    const existingIdentifier = await ctx.db
      .query("demoProjects")
      .withIndex("by_groupId_and_identifier", (q) =>
        q.eq("groupId", args.workspaceId).eq("identifier", identifier),
      )
      .first();
    if (existingIdentifier) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Identifier "${identifier}" is already in use.`,
      });
    }

    const slug = toSlug(args.name) || "project";

    const existingSlug = await ctx.db
      .query("demoProjects")
      .withIndex("by_groupId_and_slug", (q) =>
        q.eq("groupId", args.workspaceId).eq("slug", slug),
      )
      .first();
    if (existingSlug) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "A project with that name already exists.",
      });
    }

    const projectId = await ctx.db.insert("demoProjects", {
      groupId: args.workspaceId,
      ...(args.teamGroupId ? { teamGroupId: args.teamGroupId } : {}),
      name: args.name.trim(),
      identifier,
      slug,
      description: args.description.trim(),
      status: "active",
      createdByUserId: userId,
      issueCounter: 0,
      openIssueCount: 0,
    });

    return { projectId };
  },
});

export const createIssue = authMutation({
  args: {
    projectId: v.id("demoProjects"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(issuePriorityValidator),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ issueId: v.id("demoIssues") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Project not found.",
      });
    }

    const scopeGroupId = project.teamGroupId ?? project.groupId;
    await auth.member.require(ctx, {
      userId,
      groupId: scopeGroupId,
      grants: ["issues.create"],
    });

    const nextNumber = project.issueCounter + 1;
    const openCount = (project.openIssueCount ?? 0) + 1;
    await ctx.db.patch(args.projectId, {
      issueCounter: nextNumber,
      openIssueCount: openCount,
    });

    const issueId = await ctx.db.insert("demoIssues", {
      projectId: project._id,
      groupId: project.groupId,
      scopeGroupId,
      number: nextNumber,
      title: args.title.trim(),
      description: args.description?.trim() ?? "",
      status: "backlog",
      priority: args.priority ?? "none",
      createdByUserId: userId,
      labels: args.labels ?? [],
      position: nextNumber,
    });

    return { issueId };
  },
});

export const updateIssue = authMutation({
  args: {
    issueId: v.id("demoIssues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assigneeUserId: v.optional(v.union(v.string(), v.null())),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ issueId: v.id("demoIssues") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const issue = await ctx.db.get(args.issueId);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

    // Check which permissions are needed based on which fields are being updated
    const needsEdit =
      args.title !== undefined ||
      args.description !== undefined ||
      args.priority !== undefined ||
      args.labels !== undefined;
    const needsMove = args.status !== undefined;
    const needsAssign = args.assigneeUserId !== undefined;

    if (needsEdit) {
      await auth.member.require(ctx, {
        userId,
        groupId: issue.scopeGroupId,
        grants: ["issues.edit"],
      });

      // Members can only edit their own or assigned issues
      try {
        await auth.member.require(ctx, {
          userId,
          groupId: issue.scopeGroupId,
          grants: ["issues.assign"],
        });
      } catch {
        const isOwnerOrAssignee =
          issue.createdByUserId === userId || issue.assigneeUserId === userId;
        if (!isOwnerOrAssignee)
          throw new ConvexError({
            code: "FORBIDDEN",
            message: "Access denied.",
          });
      }
    }

    if (needsMove) {
      await auth.member.require(ctx, {
        userId,
        groupId: issue.scopeGroupId,
        grants: ["issues.move"],
      });
    }

    if (needsAssign) {
      const isSelfAssign = args.assigneeUserId === userId;
      if (!isSelfAssign) {
        await auth.member.require(ctx, {
          userId,
          groupId: issue.scopeGroupId,
          grants: ["issues.assign"],
        });
      } else {
        // Self-assignment requires at least issues.move
        await auth.member.require(ctx, {
          userId,
          groupId: issue.scopeGroupId,
          grants: ["issues.move"],
        });
      }
    }

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined)
      patch.description = args.description.trim();
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.assigneeUserId !== undefined)
      patch.assigneeUserId =
        args.assigneeUserId === null ? undefined : args.assigneeUserId;
    if (args.labels !== undefined) patch.labels = args.labels;

    // Update denormalized openIssueCount when status changes
    if (args.status !== undefined && args.status !== issue.status) {
      const wasOpen = issue.status !== "done" && issue.status !== "cancelled";
      const isNowOpen = args.status !== "done" && args.status !== "cancelled";
      if (wasOpen !== isNowOpen) {
        const project = await ctx.db.get(issue.projectId);
        if (project) {
          const delta = isNowOpen ? 1 : -1;
          await ctx.db.patch(issue.projectId, {
            openIssueCount: Math.max(0, (project.openIssueCount ?? 0) + delta),
          });
        }
      }
    }

    await ctx.db.patch(args.issueId, patch);
    return { issueId: args.issueId };
  },
});

export const deleteIssue = authMutation({
  args: {
    issueId: v.id("demoIssues"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const issue = await ctx.db.get(args.issueId);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

    await auth.member.require(ctx, {
      userId,
      groupId: issue.scopeGroupId,
      grants: ["issues.delete"],
    });

    // Delete comments first (bounded to avoid hitting read limits)
    let batch = await ctx.db
      .query("demoComments")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
      .take(200);
    while (batch.length > 0) {
      for (const comment of batch) {
        await ctx.db.delete(comment._id);
      }
      if (batch.length < 200) break;
      batch = await ctx.db
        .query("demoComments")
        .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
        .take(200);
    }

    // Update denormalized count if the issue was open
    const isOpen = issue.status !== "done" && issue.status !== "cancelled";
    if (isOpen) {
      const project = await ctx.db.get(issue.projectId);
      if (project) {
        await ctx.db.patch(issue.projectId, {
          openIssueCount: Math.max(0, (project.openIssueCount ?? 0) - 1),
        });
      }
    }

    await ctx.db.delete(args.issueId);
    return null;
  },
});

export const createComment = authMutation({
  args: {
    issueId: v.id("demoIssues"),
    body: v.string(),
  },
  returns: v.object({ commentId: v.id("demoComments") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const issue = await ctx.db.get(args.issueId);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

    const body = args.body.trim();
    if (body.length === 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Comment cannot be empty.",
      });
    }

    await auth.member.require(ctx, {
      userId,
      groupId: issue.scopeGroupId,
      grants: ["comments.create"],
    });

    const commentId = await ctx.db.insert("demoComments", {
      issueId: issue._id,
      groupId: issue.groupId,
      authorUserId: userId,
      body,
    });

    return { commentId };
  },
});

export const deleteComment = authMutation({
  args: {
    commentId: v.id("demoComments"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const comment = await ctx.db.get(args.commentId);
    if (comment === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Comment not found.",
      });
    }

    // Author can always delete their own comment
    if (comment.authorUserId !== userId) {
      const issue = await ctx.db.get(comment.issueId);
      if (issue === null) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Issue not found.",
        });
      }
      await auth.member.require(ctx, {
        userId,
        groupId: issue.scopeGroupId,
        grants: ["comments.delete"],
      });
    }

    await ctx.db.delete(args.commentId);
    return null;
  },
});

export const createTeam = authMutation({
  args: {
    workspaceId: v.string(),
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
      groupId: args.workspaceId,
      grants: ["teams.manage"],
    });

    const { groupId } = await auth.group.create(ctx, {
      name: teamName,
      parentGroupId: args.parentTeamId ?? args.workspaceId,
      type: "team",
      tags: [{ key: "demo", value: "team" }],
    });
    return { groupId };
  },
});

export const updateMemberRole = authMutation({
  args: {
    workspaceId: v.string(),
    memberId: v.string(),
    roleId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.workspaceId,
      grants: ["members.manage"],
    });

    // Validate the role ID
    const validRoleIds = [
      roles.orgAdmin.id,
      roles.member.id,
      roles.viewer.id,
    ] as const;
    const matched = validRoleIds.find((id) => id === args.roleId);
    if (!matched) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Invalid role.",
      });
    }

    // Prevent demoting the last admin
    if (matched !== roles.orgAdmin.id) {
      const members = await auth.member.list(ctx, {
        where: { groupId: args.workspaceId },
        limit: 50,
      });
      const adminCount = members.items.filter(
        (m: (typeof members.items)[number]) =>
          m.roleIds?.includes(roles.orgAdmin.id) && m._id !== args.memberId,
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
    workspaceId: v.string(),
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
      groupId: args.workspaceId,
      grants: ["members.manage"],
    });

    const validRoleIds = [
      roles.orgAdmin.id,
      roles.member.id,
      roles.viewer.id,
    ] as const;
    const matched = validRoleIds.find((id) => id === args.roleId);
    if (!matched) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Invalid role.",
      });
    }

    const result = await auth.invite.create(ctx, {
      groupId: args.workspaceId,
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
    workspaceId: v.string(),
    email: v.string(),
    roleId: v.string(),
  },
  returns: v.object({ inviteId: v.string() }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const email = args.email.trim().toLowerCase();

    const result: {
      inviteId: string;
      token: string;
    } = await ctx.runMutation(internal.demo.createInviteInternal, {
      workspaceId: args.workspaceId,
      email,
      roleId: args.roleId,
      invitedByUserId: userId,
    });

    // Send invite email via Resend
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
          subject: "You've been invited to a workspace",
          html: `<p>You've been invited to join a workspace.</p><p><a href="${inviteLink}">Accept invitation</a></p>`,
        }),
      });
      if (!res.ok) {
        console.error("Invite email failed:", res.status);
      }
    } catch (e) {
      console.error("Invite email error:", e);
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
    workspaceId: v.string(),
  },
  returns: v.array(inviteSummary),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.workspaceId,
      grants: ["members.manage"],
    });

    const result = await auth.invite.list(ctx, {
      where: { groupId: args.workspaceId, status: "pending" },
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
    workspaceId: v.string(),
    inviteId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    await auth.member.require(ctx, {
      userId,
      groupId: args.workspaceId,
      grants: ["members.manage"],
    });

    await auth.invite.revoke(ctx, args.inviteId);
    return null;
  },
});
