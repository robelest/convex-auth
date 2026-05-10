import type { UserIdentity } from "convex/server";

import type { AuthContext, AuthLike, OptionalAuthContext, UserDoc } from "./facade";
import type { ComponentReadCtx as AuthQueryCtx } from "./component/context";
import { getAuthenticatedUserIdOrNull } from "./identity";

type AuthIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
};

type AuthContextResolverLike = {
  user: {
    get: (ctx: AuthQueryCtx, userId: string) => Promise<UserDoc | null>;
    getActiveGroup: (ctx: AuthQueryCtx, args: { userId: string }) => Promise<string | null>;
  };
  member: {
    inspect: (
      ctx: AuthQueryCtx,
      args: { userId: string; groupId: string },
    ) => Promise<{
      membership: unknown;
      roleIds: string[];
      grants: string[];
    }>;
  };
};

/** @internal */
export async function getSessionUserId(ctx: AuthIdentityCtx): Promise<string | null> {
  return await getAuthenticatedUserIdOrNull(ctx);
}

/** @internal */
export async function getAuthContextForUser(
  auth: AuthContextResolverLike,
  ctx: AuthQueryCtx,
  userId: string,
): Promise<AuthContext> {
  const [user, groupId] = await Promise.all([
    auth.user.get(ctx, userId),
    auth.user.getActiveGroup(ctx, { userId }),
  ]);
  let role: string | null = null;
  let grants: string[] = [];
  if (groupId) {
    const resolved = await auth.member.inspect(ctx, { userId, groupId });
    if (resolved.membership) {
      role = resolved.roleIds[0] ?? null;
      grants = resolved.grants;
    }
  }
  return {
    userId: userId as AuthContext["userId"],
    user: user as UserDoc,
    groupId,
    role,
    grants,
  };
}

/** @internal */
export async function getAuthContext(
  auth: AuthLike,
  ctx: AuthIdentityCtx & AuthQueryCtx,
): Promise<AuthContext | null> {
  const userId = await getSessionUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await getAuthContextForUser(
    auth as unknown as AuthContextResolverLike,
    ctx as AuthQueryCtx,
    userId,
  );
}

/** @internal */
export function createUnauthenticatedAuthContext(): OptionalAuthContext {
  return {
    userId: null,
    user: null,
    groupId: null,
    role: null,
    grants: [],
  };
}
