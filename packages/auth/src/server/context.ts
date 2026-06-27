import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";
import type { AuthContext, AuthLike, OptionalAuthContext, UserDoc } from "./facade";
import type { ComponentReadCtx as AuthQueryCtx } from "./component/context";
import {
  getAuthenticatedUserIdOrNull,
  getUserIdentityOrNull,
  oauthScopesFromIdentity,
  userIdFromIdentity,
} from "./identity/claims";

type AuthIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
};

type AuthContextResolverLike = {
  user: {
    get: (ctx: AuthQueryCtx, args: { id: string }) => Promise<UserDoc | null>;
  };
  active: {
    get: (ctx: AuthQueryCtx, args: { userId: string }) => Promise<{ groupId: string } | null>;
  };
  member: {
    get: (
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
 * Build the `ctx.auth.assert` grant guard from the resolved grants and
 * active group. `assert(grant)` throws when a grant is missing;
 * `assert(grant, doc)` additionally asserts the group-owned `doc` belongs
 * to the active group. Reuses `member.assert`'s `MISSING_GRANTS` code.
 *
 * @internal
 */
function makeAssert(groupId: string | null, grants: readonly string[]): AuthContext["assert"] {
  return (grant, doc) => {
    const needed = Array.isArray(grant) ? grant : [grant as string];
    const missing = needed.filter((g) => !grants.includes(g));
    if (missing.length > 0) {
      throw new ConvexError({
        code: ErrorCode.MISSING_GRANTS,
        message: "User is missing required grants.",
      });
    }
    if (doc !== undefined) {
      const docGroupId = (doc as { groupId?: unknown }).groupId;
      if (groupId === null || String(docGroupId) !== groupId) {
        throw new ConvexError({
          code: ErrorCode.FORBIDDEN,
          message: "Record is not in the active group.",
        });
      }
    }
  };
}

/**
 * @internal
 *
 * Resolve the caller's auth context. When `oauthScopes` is supplied (the request
 * is authenticated by a scoped OAuth access token rather than a full session),
 * the user's role grants are intersected with the token's scopes so the caller's
 * effective grants — and therefore `assert` — can never exceed the granted
 * scope. Scopes and grants share one vocabulary, so this is a set intersection.
 * A session caller passes no scopes and keeps their full role grants.
 */
export async function getAuthContextForUser(
  auth: AuthContextResolverLike,
  ctx: AuthQueryCtx,
  userId: string,
  oauthScopes?: readonly string[],
): Promise<AuthContext> {
  const [user, activeGroup] = await Promise.all([
    auth.user.get(ctx, { id: userId }),
    auth.active.get(ctx, { userId }),
  ]);
  const groupId = activeGroup?.groupId ?? null;
  let role: string | null = null;
  let grants: string[] = [];
  if (groupId) {
    const resolved = await auth.member.get(ctx, { userId, groupId });
    if (resolved.membership) {
      role = resolved.roleIds[0] ?? null;
      grants = resolved.grants;
    }
  }
  const effectiveGrants =
    oauthScopes === undefined ? grants : grants.filter((grant) => oauthScopes.includes(grant));
  return {
    userId: userId as AuthContext["userId"],
    user: user as UserDoc,
    groupId,
    role,
    grants: effectiveGrants,
    assert: makeAssert(groupId, effectiveGrants),
  };
}

/** @internal */
export async function getAuthContext(
  auth: AuthLike,
  ctx: AuthIdentityCtx & AuthQueryCtx,
): Promise<AuthContext | null> {
  const identity = await getUserIdentityOrNull(ctx);
  if (identity === null) {
    return null;
  }
  const userId = userIdFromIdentity(identity);
  const oauthScopes = oauthScopesFromIdentity(identity);
  return await getAuthContextForUser(
    auth as AuthContextResolverLike,
    ctx as AuthQueryCtx,
    userId,
    oauthScopes ?? undefined,
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
    assert: makeAssert(null, []),
  };
}
