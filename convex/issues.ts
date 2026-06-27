import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { internalMutation, internalQuery } from "./_generated/server";
import { auth } from "./auth/core";
import { authMutation, authQuery } from "./functions";
import {
  issuePriority as issuePriorityValidator,
  issueStatus as issueStatusValidator,
} from "./schema";

type UserLookup = { name?: string; email?: string } | null;

function toIssueView(
  project: Doc<"projects">,
  issue: Doc<"issues">,
  userMap: Map<string, UserLookup>,
) {
  const assignee = issue.assigneeUserId ? userMap.get(issue.assigneeUserId) : null;
  const creator = userMap.get(issue.createdByUserId);
  return {
    _id: issue._id,
    identifier: `${project.identifier}-${issue.number}`,
    number: issue.number,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    labels: issue.labels ?? [],
    assigneeName: assignee ? (assignee.name ?? assignee.email ?? null) : null,
    assigneeUserId: issue.assigneeUserId ?? null,
    createdByName: creator?.name ?? creator?.email ?? "Unknown",
    createdByUserId: issue.createdByUserId,
    projectId: issue.projectId,
    groupId: issue.groupId,
  };
}

const issueViewValidator = v.object({
  _id: v.id("issues"),
  identifier: v.string(),
  number: v.number(),
  title: v.string(),
  status: v.string(),
  priority: v.string(),
  labels: v.array(v.string()),
  assigneeName: v.union(v.string(), v.null()),
  assigneeUserId: v.union(v.string(), v.null()),
  createdByName: v.string(),
  createdByUserId: v.string(),
  projectId: v.id("projects"),
  groupId: v.string(),
});

export const forProject = authQuery({
  args: { projectId: v.string() },
  returns: v.object({
    project: v.union(
      v.object({
        _id: v.id("projects"),
        groupId: v.string(),
        name: v.string(),
        identifier: v.string(),
        slug: v.string(),
        description: v.string(),
        status: v.string(),
        issueCounter: v.number(),
        openIssueCount: v.number(),
      }),
      v.null(),
    ),
    issues: v.array(issueViewValidator),
  }),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) return { project: null, issues: [] };
    const project = await ctx.db.get(projectId);
    if (!project) return { project: null, issues: [] };
    const userId = ctx.auth.userId;

    await auth.member.assert(ctx, {
      userId,
      groupId: project.groupId,
      grants: ["projects.read"],
    });

    const issues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(200);

    const allUserIds = Array.from(
      new Set(
        issues.flatMap((i) => [i.createdByUserId, i.assigneeUserId].filter(Boolean) as string[]),
      ),
    );
    const userDocs = await auth.user.get(ctx, { ids: allUserIds });
    const userMap = new Map<string, UserLookup>(allUserIds.map((id, i) => [id, userDocs[i]]));

    return {
      project: {
        _id: project._id,
        groupId: project.groupId,
        name: project.name,
        identifier: project.identifier,
        slug: project.slug,
        description: project.description,
        status: project.status,
        issueCounter: project.issueCounter,
        openIssueCount: project.openIssueCount ?? 0,
      },
      issues: [...issues]
        .sort((a, b) => a.position - b.position)
        .map((issue) => toIssueView(project, issue, userMap)),
    };
  },
});

export const detail = authQuery({
  args: { issueId: v.string() },
  returns: v.union(issueViewValidator, v.null()),
  handler: async (ctx, args) => {
    const issueId = ctx.db.normalizeId("issues", args.issueId);
    if (!issueId) return null;

    const issue = await ctx.db.get(issueId);
    if (!issue) return null;
    const userId = ctx.auth.userId;

    const ids = [issue.createdByUserId, issue.assigneeUserId].filter(Boolean) as string[];
    const [project, userDocs] = await Promise.all([
      ctx.db.get(issue.projectId),
      auth.user.get(ctx, { ids }),
      auth.member.assert(ctx, {
        userId,
        groupId: issue.groupId,
        grants: ["projects.read"],
      }),
    ]);
    if (!project) return null;
    const userMap = new Map<string, UserLookup>(ids.map((id, i) => [id, userDocs[i]]));

    return toIssueView(project, issue, userMap);
  },
});

export const create = authMutation({
  args: {
    projectId: v.string(),
    title: v.string(),
    priority: v.optional(issuePriorityValidator),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ issueId: v.id("issues") }),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const userId = ctx.auth.userId;

    await auth.member.assert(ctx, {
      userId,
      groupId: project.groupId,
      grants: ["issues.create"],
    });

    const nextNumber = project.issueCounter + 1;
    await ctx.db.patch(projectId, {
      issueCounter: nextNumber,
      openIssueCount: (project.openIssueCount ?? 0) + 1,
    });

    const issueId = await ctx.db.insert("issues", {
      projectId: project._id,
      groupId: project.groupId,
      scopeGroupId: project.groupId,
      number: nextNumber,
      title: args.title.trim(),
      status: "backlog",
      priority: args.priority ?? "none",
      createdByUserId: userId,
      labels: args.labels ?? [],
      position: nextNumber,
    });

    return { issueId };
  },
});

export const update = authMutation({
  args: {
    issueId: v.string(),
    title: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assigneeUserId: v.optional(v.union(v.string(), v.null())),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = ctx.auth.userId;
    const issueId = ctx.db.normalizeId("issues", args.issueId);
    if (!issueId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }
    const issue = await ctx.db.get(issueId);
    if (!issue) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

    const needsEdit =
      args.title !== undefined ||
      args.priority !== undefined ||
      args.labels !== undefined;
    const needsMove = args.status !== undefined;
    const needsAssign = args.assigneeUserId !== undefined;

    if (needsEdit) {
      await auth.member.assert(ctx, { userId, groupId: issue.groupId, grants: ["issues.edit"] });
      try {
        await auth.member.assert(ctx, {
          userId,
          groupId: issue.groupId,
          grants: ["issues.assign"],
        });
      } catch {
        const isOwnerOrAssignee =
          issue.createdByUserId === userId || issue.assigneeUserId === userId;
        if (!isOwnerOrAssignee) {
          throw new ConvexError({ code: "FORBIDDEN", message: "Access denied." });
        }
      }
    }
    if (needsMove) {
      await auth.member.assert(ctx, { userId, groupId: issue.groupId, grants: ["issues.move"] });
    }
    if (needsAssign) {
      const grant = args.assigneeUserId !== userId ? "issues.assign" : "issues.move";
      await auth.member.assert(ctx, { userId, groupId: issue.groupId, grants: [grant] });
    }

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.assigneeUserId !== undefined) {
      patch.assigneeUserId = args.assigneeUserId === null ? undefined : args.assigneeUserId;
    }
    if (args.labels !== undefined) patch.labels = args.labels;

    if (args.status !== undefined && args.status !== issue.status) {
      const wasOpen = issue.status !== "done" && issue.status !== "cancelled";
      const isNowOpen = args.status !== "done" && args.status !== "cancelled";
      if (wasOpen !== isNowOpen) {
        const project = await ctx.db.get(issue.projectId);
        if (project) {
          await ctx.db.patch(issue.projectId, {
            openIssueCount: Math.max(0, (project.openIssueCount ?? 0) + (isNowOpen ? 1 : -1)),
          });
        }
      }
    }

    await ctx.db.patch(issueId, patch);
    return null;
  },
});

export const remove = authMutation({
  args: { issueId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const issueId = ctx.db.normalizeId("issues", args.issueId);
    if (!issueId) return null;

    const issue = await ctx.db.get(issueId);
    if (!issue) return null;
    const userId = ctx.auth.userId;

    await auth.member.assert(ctx, {
      userId,
      groupId: issue.groupId,
      grants: ["issues.delete"],
    });

    let batch = await ctx.db
      .query("comments")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
      .take(200);
    while (batch.length > 0) {
      for (const comment of batch) await ctx.db.delete(comment._id);
      if (batch.length < 200) break;
      batch = await ctx.db
        .query("comments")
        .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
        .take(200);
    }

    const isOpen = issue.status !== "done" && issue.status !== "cancelled";
    if (isOpen) {
      const project = await ctx.db.get(issue.projectId);
      if (project) {
        await ctx.db.patch(issue.projectId, {
          openIssueCount: Math.max(0, (project.openIssueCount ?? 0) - 1),
        });
      }
    }

    await ctx.db.delete(issueId);
    return null;
  },
});

export const getProjectForApi = internalQuery({
  args: { projectId: v.string() },
  returns: v.union(
    v.object({
      projectId: v.id("projects"),
      groupId: v.string(),
      name: v.string(),
      identifier: v.string(),
      openIssueCount: v.number(),
      issueCounter: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) return null;
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    return {
      projectId: project._id,
      groupId: project.groupId,
      name: project.name,
      identifier: project.identifier,
      openIssueCount: project.openIssueCount ?? 0,
      issueCounter: project.issueCounter,
    };
  },
});

export const listIssuesForApi = internalQuery({
  args: { projectId: v.string() },
  returns: v.array(
    v.object({
      issueId: v.id("issues"),
      number: v.number(),
      title: v.string(),
      status: issueStatusValidator,
      priority: issuePriorityValidator,
      labels: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) return [];
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .order("asc")
      .take(100);
    return issues.map((issue) => ({
      issueId: issue._id,
      number: issue.number,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      labels: issue.labels ?? [],
    }));
  },
});

export const createIssueForApi = internalMutation({
  args: {
    projectId: v.string(),
    userId: v.string(),
    title: v.string(),
  },
  returns: v.object({ issueId: v.id("issues"), number: v.number() }),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const number = project.issueCounter + 1;
    await ctx.db.patch(projectId, {
      issueCounter: number,
      openIssueCount: (project.openIssueCount ?? 0) + 1,
    });
    const issueId = await ctx.db.insert("issues", {
      projectId,
      groupId: project.groupId,
      scopeGroupId: project.groupId,
      number,
      title: args.title.trim(),
      status: "backlog",
      priority: "medium",
      createdByUserId: args.userId,
      labels: [],
      position: Date.now(),
    });
    return { issueId, number };
  },
});
