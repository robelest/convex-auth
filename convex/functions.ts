import { ConvexError } from "convex/values";
import { createBuilder } from "fluent-convex";
import { WithZod } from "fluent-convex/zod";
import type { Auth as ConvexNativeAuth } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { auth } from "./auth";

const convex = createBuilder<DataModel>();

const withRequiredAuth = convex
  .$context<{ auth: ConvexNativeAuth }>()
  .createMiddleware(async (ctx, next) => {
    const nativeAuth = ctx.auth;
    const userId = await auth.user.require(ctx);
    const user = await auth.user.get(ctx, userId);
    if (user === null) {
      throw new ConvexError({
        code: "USER_NOT_FOUND",
        message: "Authenticated user not found",
      });
    }

    return next({
      ...ctx,
      auth: {
        ...nativeAuth,
        getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
        userId,
        user,
      },
    });
  });

export const publicQuery = convex.query().extend(WithZod);
export const publicMutation = convex.mutation().extend(WithZod);
export const publicAction = convex.action().extend(WithZod);

export const authQuery = convex.query().use(withRequiredAuth).extend(WithZod);
export const authMutation = convex
  .mutation()
  .use(withRequiredAuth)
  .extend(WithZod);
export const authAction = convex.action().use(withRequiredAuth).extend(WithZod);

// Backward-compatible aliases used across the demo app.
export const query = authQuery;
export const mutation = authMutation;
export const action = authAction;

export const internalQuery = convex.query().extend(WithZod);
export const internalMutation = convex.mutation().extend(WithZod);
export const internalAction = convex.action().extend(WithZod);
