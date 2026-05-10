import { ConvexError } from "convex/values";

import { action, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;

export async function requireUserId(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: "NOT_SIGNED_IN", message: "Authentication required." });
  }
  return identity.subject;
}

export async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: "NOT_SIGNED_IN", message: "Authentication required." });
  }
  return identity;
}

export const authQuery = query;
export const authMutation = mutation;
export const authAction = action;

export const authUserQuery = query;
export const authUserMutation = mutation;
export const authUserAction = action;
