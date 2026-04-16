import { ConvexError, v } from "convex/values";

import { auth } from "./auth/core";
import { authMutation, authQuery } from "./functions";
import { toSlug } from "./shared";

const projectSummary = v.object({
  projectId: v.id("projects"),
  name: v.string(),
  identifier: v.string(),
  slug: v.string(),
  description: v.string(),
  status: v.string(),
  issueCount: v.number(),
  openIssueCount: v.number(),
});

async function listProjectsForGroup(ctx: any, userId: string, groupId: string) {
  await auth.member.require(ctx, {
    userId,
    groupId,
    grants: ["projects.read"],
  });

  const projects = await ctx.db
    .query("projects")
    .withIndex("by_groupId", (q: any) => q.eq("groupId", groupId))
    .take(100);

  return projects.map((project: any) => ({
    projectId: project._id,
    name: project.name,
    identifier: project.identifier,
    slug: project.slug,
    description: project.description,
    status: project.status,
    issueCount: project.issueCounter,
    openIssueCount: project.openIssueCount ?? 0,
  }));
}

async function createProjectRecord(
  ctx: any,
  userId: string,
  args: {
    groupId: string;
    name: string;
    identifier: string;
    description: string;
  },
) {
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
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Identifier must be at least 2 characters.",
    });
  }

  const existingIdentifier = await ctx.db
    .query("projects")
    .withIndex("by_groupId_and_identifier", (q: any) =>
      q.eq("groupId", args.groupId).eq("identifier", identifier),
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
    .query("projects")
    .withIndex("by_groupId_and_slug", (q: any) =>
      q.eq("groupId", args.groupId).eq("slug", slug),
    )
    .first();
  if (existingSlug) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "A project with that name already exists.",
    });
  }

  const projectId = await ctx.db.insert("projects", {
    groupId: args.groupId,
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
}

export const listProjects = authQuery({
  args: { groupId: v.string() },
  returns: v.array(projectSummary),
  handler: async (ctx, args) =>
    await listProjectsForGroup(ctx, ctx.auth.userId, args.groupId),
});

export const createProject = authMutation({
  args: {
    groupId: v.string(),
    name: v.string(),
    identifier: v.string(),
    description: v.string(),
  },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args) =>
    await createProjectRecord(ctx, ctx.auth.userId, args),
});

export const createProjectByString = authMutation({
  args: {
    groupId: v.string(),
    name: v.string(),
    identifier: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args) =>
    await createProjectRecord(ctx, ctx.auth.userId, {
      ...args,
      description: args.description ?? "",
    }),
});
