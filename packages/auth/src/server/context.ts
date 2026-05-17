import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

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
  };
  active: {
    get: (
      ctx: AuthQueryCtx,
      args: { userId: string },
    ) => Promise<{ groupId: string } | null>;
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

/**
 * Build the `ctx.auth.require` grant guard from the resolved grants and
 * active group. `require(grant)` throws when a grant is missing;
 * `require(grant, doc)` additionally asserts the group-owned `doc` belongs
 * to the active group. Reuses `member.require`'s `MISSING_GRANTS` code.
 *
 * @internal
 */
function makeRequire(
  groupId: string | null,
  grants: readonly string[],
): AuthContext["require"] {
  return (grant, doc) => {
    const needed = Array.isArray(grant) ? grant : [grant as string];
    const missing = needed.filter((g) => !grants.includes(g));
    if (missing.length > 0) {
      throw new ConvexError({
        code: "MISSING_GRANTS",
        message: "User is missing required grants.",
      });
    }
    if (doc !== undefined) {
      const docGroupId = (doc as { groupId?: unknown }).groupId;
      if (groupId === null || String(docGroupId) !== groupId) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Record is not in the active group.",
        });
      }
    }
  };
}

/** @internal */
export async function getAuthContextForUser(
  auth: AuthContextResolverLike,
  ctx: AuthQueryCtx,
  userId: string,
): Promise<AuthContext> {
  const [user, activeGroup] = await Promise.all([
    auth.user.get(ctx, userId),
    auth.active.get(ctx, { userId }),
  ]);
  const groupId = activeGroup?.groupId ?? null;
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
    require: makeRequire(groupId, grants),
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
    require: makeRequire(null, []),
  };
}
