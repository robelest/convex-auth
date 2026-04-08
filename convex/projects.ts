import { ConvexError, v } from "convex/values";

import { auth } from "./auth";
import { authMutation } from "./functions";
import { toSlug } from "./shared";

export const createProject = authMutation({
  args: {
    groupId: v.string(),
    teamGroupId: v.optional(v.string()),
    name: v.string(),
    identifier: v.string(),
    description: v.string(),
  },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args) => {
    const { userId } = ctx.auth;

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
      .withIndex("by_groupId_and_identifier", (q) =>
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
      .withIndex("by_groupId_and_slug", (q) =>
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
