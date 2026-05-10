import { ConvexError, v } from "convex/values";

import { auth } from "./auth/core";
import { authMutation, authQuery, requireUserId } from "./functions";

export const list = authQuery({
  args: { groupId: v.string() },
  returns: v.array(
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
  ),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await auth.member.require(ctx, {
      userId,
      groupId: args.groupId,
      grants: ["projects.read"],
    });

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_groupId", (q) => q.eq("groupId", args.groupId))
      .take(100);

    return projects.map((project) => ({
      _id: project._id,
      groupId: project.groupId,
      name: project.name,
      identifier: project.identifier,
      slug: project.slug,
      description: project.description,
      status: project.status,
      issueCounter: project.issueCounter,
      openIssueCount: project.openIssueCount ?? 0,
    }));
  },
});

export const create = authMutation({
  args: {
    groupId: v.string(),
    name: v.string(),
    identifier: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await auth.member.require(ctx, {
      userId,
      groupId: args.groupId,
      grants: ["projects.create"],
    });

    const identifier = args.identifier
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (identifier.length < 2) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Identifier must be at least 2 characters." });
    }

    const slug = args.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    if (slug.length === 0) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Project name is required." });
    }

    const existingIdentifier = await ctx.db
      .query("projects")
      .withIndex("by_groupId_and_identifier", (q) =>
        q.eq("groupId", args.groupId).eq("identifier", identifier),
      )
      .first();
    if (existingIdentifier) {
      throw new ConvexError({ code: "INVALID_INPUT", message: `Identifier "${identifier}" is already in use.` });
    }

    const existingSlug = await ctx.db
      .query("projects")
      .withIndex("by_groupId_and_slug", (q) => q.eq("groupId", args.groupId).eq("slug", slug))
      .first();
    if (existingSlug) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "A project with that name already exists." });
    }

    const projectId = await ctx.db.insert("projects", {
      groupId: args.groupId,
      name: args.name.trim(),
      identifier,
      slug,
      description: args.description?.trim() ?? "",
      status: "active",
      createdByUserId: userId,
      issueCounter: 0,
      openIssueCount: 0,
    });

    return { projectId };
  },
});

export const detail = authQuery({
  args: { projectId: v.string() },
  returns: v.union(
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
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) return null;

    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const userId = await requireUserId(ctx);

    await auth.member.require(ctx, {
      userId,
      groupId: project.groupId,
      grants: ["projects.read"],
    });

    return {
      _id: project._id,
      groupId: project.groupId,
      name: project.name,
      identifier: project.identifier,
      slug: project.slug,
      description: project.description,
      status: project.status,
      issueCounter: project.issueCounter,
      openIssueCount: project.openIssueCount ?? 0,
    };
  },
});

export const update = authMutation({
  args: {
    projectId: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const projectId = ctx.db.normalizeId("projects", args.projectId);
    if (!projectId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const userId = await requireUserId(ctx);

    await auth.member.require(ctx, {
      userId,
      groupId: project.groupId,
      grants: ["projects.manage"],
    });

    if (args.description !== undefined) {
      await ctx.db.patch(project._id, { description: args.description.trim() });
    }
    return null;
  },
});
