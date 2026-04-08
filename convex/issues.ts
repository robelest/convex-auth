import { ConvexError, v } from "convex/values";

import { auth } from "./auth";
import { authMutation, authQuery } from "./functions";
import {
  issuePriority as issuePriorityValidator,
  issueStatus as issueStatusValidator,
} from "./schema";
import { getUserSummary, issueSummary } from "./shared";

const projectIssueSummary = v.object({
  projectId: v.id("projects"),
  name: v.string(),
  identifier: v.string(),
  description: v.string(),
  teamName: v.union(v.string(), v.null()),
  teamGroupId: v.union(v.string(), v.null()),
});

export const projectIssues = authQuery({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.object({
    project: v.union(projectIssueSummary, v.null()),
    issues: v.array(issueSummary),
  }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
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
      .query("issues")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(200);

    const assigneeMap = new Map<string, Awaited<ReturnType<typeof getUserSummary>>>();
    const creatorMap = new Map<string, Awaited<ReturnType<typeof getUserSummary>>>();

    for (const issue of issues) {
      if (issue.assigneeUserId && !assigneeMap.has(issue.assigneeUserId)) {
        assigneeMap.set(
          issue.assigneeUserId,
          await getUserSummary(ctx, issue.assigneeUserId),
        );
      }
      if (!creatorMap.has(issue.createdByUserId)) {
        creatorMap.set(
          issue.createdByUserId,
          await getUserSummary(ctx, issue.createdByUserId),
        );
      }
    }

    return {
      project: {
        projectId: project._id,
        name: project.name,
        identifier: project.identifier,
        description: project.description,
        teamName: teamGroup?.name ?? null,
        teamGroupId: project.teamGroupId ?? null,
      },
      issues: issues
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
        })),
    };
  },
});

export const createIssue = authMutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(issuePriorityValidator),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ issueId: v.id("issues") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const project = await ctx.db.get(args.projectId);
    if (project === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }

    const scopeGroupId = project.teamGroupId ?? project.groupId;
    await auth.member.require(ctx, {
      userId,
      groupId: scopeGroupId,
      grants: ["issues.create"],
    });

    const nextNumber = project.issueCounter + 1;
    await ctx.db.patch(args.projectId, {
      issueCounter: nextNumber,
      openIssueCount: (project.openIssueCount ?? 0) + 1,
    });

    const issueId = await ctx.db.insert("issues", {
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
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assigneeUserId: v.optional(v.union(v.string(), v.null())),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ issueId: v.id("issues") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

    const issue = await ctx.db.get(args.issueId);
    if (issue === null) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

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

      try {
        await auth.member.require(ctx, {
          userId,
          groupId: issue.scopeGroupId,
          grants: ["issues.assign"],
        });
      } catch {
        const isOwnerOrAssignee =
          issue.createdByUserId === userId || issue.assigneeUserId === userId;
        if (!isOwnerOrAssignee) {
          throw new ConvexError({
            code: "FORBIDDEN",
            message: "Access denied.",
          });
        }
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
      if (args.assigneeUserId !== userId) {
        await auth.member.require(ctx, {
          userId,
          groupId: issue.scopeGroupId,
          grants: ["issues.assign"],
        });
      } else {
        await auth.member.require(ctx, {
          userId,
          groupId: issue.scopeGroupId,
          grants: ["issues.move"],
        });
      }
    }

    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined) patch.description = args.description.trim();
    if (args.status !== undefined) patch.status = args.status;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.assigneeUserId !== undefined) {
      patch.assigneeUserId =
        args.assigneeUserId === null ? undefined : args.assigneeUserId;
    }
    if (args.labels !== undefined) patch.labels = args.labels;

    if (args.status !== undefined && args.status !== issue.status) {
      const wasOpen = issue.status !== "done" && issue.status !== "cancelled";
      const isNowOpen = args.status !== "done" && args.status !== "cancelled";
      if (wasOpen !== isNowOpen) {
        const project = await ctx.db.get(issue.projectId);
        if (project) {
          await ctx.db.patch(issue.projectId, {
            openIssueCount: Math.max(
              0,
              (project.openIssueCount ?? 0) + (isNowOpen ? 1 : -1),
            ),
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
    issueId: v.id("issues"),
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

    let batch = await ctx.db
      .query("comments")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
      .take(200);
    while (batch.length > 0) {
      for (const comment of batch) {
        await ctx.db.delete(comment._id);
      }
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

    await ctx.db.delete(args.issueId);
    return null;
  },
});
