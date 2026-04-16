import { ConvexError, v } from "convex/values";

import { auth } from "./auth/core";
import { authMutation, authQuery } from "./functions";
import { commentSummary, getUserSummary } from "./shared";

export const issueComments = authQuery({
  args: {
    issueId: v.id("issues"),
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
      groupId: issue.groupId,
      grants: ["projects.read"],
    });

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_issueId", (q) => q.eq("issueId", issue._id))
      .take(100);

    return await Promise.all(
      comments.map(async (comment) => {
        const authorSummary = await getUserSummary(ctx, comment.authorUserId);
        return {
          commentId: comment._id,
          authorName: authorSummary.name,
          authorUserId: comment.authorUserId,
          body: comment.body,
          createdAt: comment._creationTime,
        };
      }),
    );
  },
});

export const createComment = authMutation({
  args: {
    issueId: v.id("issues"),
    body: v.string(),
  },
  returns: v.object({ commentId: v.id("comments") }),
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

export const deleteComment = authMutation({
  args: {
    commentId: v.id("comments"),
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
        groupId: issue.groupId,
        grants: ["comments.delete"],
      });
    }

    await ctx.db.delete(args.commentId);
    return null;
  },
});
