import { ConvexError, v } from "convex/values";

import { auth } from "./auth/core";
import { authMutation, authQuery, requireUserId } from "./functions";

export const forIssue = authQuery({
  args: { issueId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("comments"),
      authorName: v.string(),
      authorUserId: v.string(),
      body: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const issueId = ctx.db.normalizeId("issues", args.issueId);
    if (!issueId) return [];
    const issue = await ctx.db.get(issueId);
    if (!issue) return [];
    const userId = await requireUserId(ctx);

    const [comments] = await Promise.all([
      ctx.db
        .query("comments")
        .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
        .take(100),
      auth.member.require(ctx, {
        userId,
        groupId: issue.groupId,
        grants: ["projects.read"],
      }),
    ]);

    const userIds = comments.map((c) => c.authorUserId);
    const users = await auth.user.get(ctx, userIds);

    return comments.map((comment, i) => ({
      _id: comment._id,
      authorName: users[i]?.name ?? users[i]?.email ?? "Unknown user",
      authorUserId: comment.authorUserId,
      body: comment.body,
      createdAt: comment._creationTime,
    }));
  },
});

export const create = authMutation({
  args: { issueId: v.string(), body: v.string() },
  returns: v.object({ commentId: v.id("comments") }),
  handler: async (ctx, args) => {
    const issueId = ctx.db.normalizeId("issues", args.issueId);
    if (!issueId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }
    const issue = await ctx.db.get(issueId);
    if (!issue) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
    }

    const body = args.body.trim();
    if (body.length === 0) {
      throw new ConvexError({ code: "INVALID_INPUT", message: "Comment cannot be empty." });
    }
    const userId = await requireUserId(ctx);

    await auth.member.require(ctx, {
      userId,
      groupId: issue.groupId,
      grants: ["comments.create"],
    });

    const commentId = await ctx.db.insert("comments", {
      issueId: issue._id,
      groupId: issue.groupId,
      authorUserId: userId,
      body,
    });

    return { commentId };
  },
});

export const remove = authMutation({
  args: { commentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const commentId = ctx.db.normalizeId("comments", args.commentId);
    if (!commentId) return null;

    const comment = await ctx.db.get(commentId);
    if (!comment) return null;
    const userId = await requireUserId(ctx);

    if (comment.authorUserId !== userId) {
      const issue = await ctx.db.get(comment.issueId);
      if (!issue) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Issue not found." });
      }
      await auth.member.require(ctx, {
        userId,
        groupId: issue.groupId,
        grants: ["comments.delete"],
      });
    }

    await ctx.db.delete(commentId);
    return null;
  },
});
