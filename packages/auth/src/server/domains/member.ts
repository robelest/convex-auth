import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import { configDefaults } from "../config";
import { cached, ctxCacheHas, invalidateCtxCache } from "../cache/context";
import { oauthScopesFromIdentity, userIdFromIdentity } from "../identity/claims";
import type { Doc } from "../types";

/** A ctx that may carry the request identity (present on request ctxs, absent on internal calls). */
type MaybeIdentityCtx = {
  auth?: { getUserIdentity?: () => Promise<UserIdentity | null> };
};

/** The OAuth caller of the current request: the token subject and its granted scopes, or `null` for a session / non-OAuth / unauthenticated request. */
type OAuthCaller = { userId: string; scopes: string[] };

/**
 * Resolve the OAuth caller behind the current request from its access token's
 * `client_id`/`scope` claims, or `null` when the request is a session (no
 * `client_id`), carries no identity, or the ctx exposes no identity reader.
 */
async function resolveOAuthCaller(
  ctx: ComponentReadCtx & MaybeIdentityCtx,
): Promise<OAuthCaller | null> {
  if (typeof ctx.auth?.getUserIdentity !== "function") {
    return null;
  }
  let identity: UserIdentity | null;
  try {
    identity = await ctx.auth.getUserIdentity();
  } catch {
    return null;
  }
  if (identity === null) {
    return null;
  }
  const scopes = oauthScopesFromIdentity(identity);
  if (scopes === null) {
    return null;
  }
  return { userId: userIdFromIdentity(identity), scopes };
}

/**
 * Cap a resolved grant set to the OAuth caller's scope. When the inspected
 * `userId` is the OAuth token's own subject, the grants are intersected with the
 * token scopes (scopes and grants share one vocabulary), so a scoped token can
 * never read or assert grants beyond its scope. A session caller (`caller` is
 * `null`) or an inspection of a different user passes the grants unchanged.
 */
function capGrantsForCaller(
  caller: OAuthCaller | null,
  inspectedUserId: string,
  grants: string[],
): string[] {
  if (caller === null || caller.userId !== inspectedUserId) {
    return grants;
  }
  return grants.filter((grant) => caller.scopes.includes(grant));
}

/** Convex-native `PaginationResult<T>` shape returned by the `*List` component queries. */
type Paginated<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};

type MemberDocLike = {
  _id: string;
  _creationTime: number;
  groupId: string;
  userId: string;
  role?: string;
  roleIds?: string[];
  status?: string;
  extend?: Record<string, unknown>;
} | null;

/** Options accepted by `member.list`. */
type MemberListOpts = {
  where?: { groupId?: string; userId?: string; status?: string };
  paginationOpts: { numItems: number; cursor: string | null };
  orderBy?: "_creationTime" | "status";
  order?: "asc" | "desc";
  /** Join each item's `group` document. */
  withGroup?: true;
  /** Resolve each item's `roleIds` + `grants`. */
  withGrants?: true;
};
/** A `member.list` item, enriched per the `withGroup`/`withGrants` options. */
type MemberItem<O extends MemberListOpts | undefined> = Doc<"GroupMember"> &
  (O extends { withGroup: true } ? { group: Doc<"Group"> | null } : unknown) &
  (O extends { withGrants: true } ? { roleIds: string[]; grants: string[] } : unknown);

type InspectResult = {
  membership: MemberDocLike;
  roleIds: string[];
  grants: string[];
};

export type MemberDeps = {
  config: ReturnType<typeof configDefaults>;
  normalizeRoleIds: (roleIds?: string[]) => string[];
  resolveGrantedPermissions: (roleIds?: string[]) => string[];
  groupGet: (
    ctx: ComponentReadCtx,
    opts: { ids: readonly string[] },
  ) => Promise<Array<Doc<"Group"> | null>>;
};

export function createMemberDomain(deps: MemberDeps) {
  const { config, normalizeRoleIds, resolveGrantedPermissions, groupGet } = deps;

  function memberInspect(
    ctx: ComponentReadCtx,
    opts: {
      userId: string;
      groupId: string;
      ancestry?: boolean;
      maxDepth?: number;
    },
  ): Promise<InspectResult>;
  function memberInspect(
    ctx: ComponentReadCtx,
    opts: { userId: string; groupIds: readonly string[] },
  ): Promise<Array<InspectResult>>;
  async function memberInspect(
    ctx: ComponentReadCtx,
    opts:
      | {
          userId: string;
          groupId: string;
          ancestry?: boolean;
          maxDepth?: number;
        }
      | { userId: string; groupIds: readonly string[] },
  ): Promise<InspectResult | Array<InspectResult>> {
    const oauthCaller = await resolveOAuthCaller(ctx);
    if ("groupIds" in opts) {
      const { userId, groupIds } = opts;
      if (groupIds.length === 0) return [];
      const unique = Array.from(new Set(groupIds));
      const toFetch: string[] = [];
      for (const groupId of unique) {
        if (!ctxCacheHas(ctx, `member-inspect:${userId}:${groupId}:n`)) {
          toFetch.push(groupId);
        }
      }
      if (toFetch.length > 0) {
        const docs = (await ctx.runQuery(config.component.group.member.get, {
          userId,
          groupIds: toFetch,
        })) as Array<MemberDocLike>;
        for (let i = 0; i < toFetch.length; i += 1) {
          const groupId = toFetch[i]!;
          const value = docs[i] ?? null;
          void cached(ctx, `member-inspect:${userId}:${groupId}:n`, () => Promise.resolve(value));
        }
      }
      return await Promise.all(
        groupIds.map(async (groupId) => {
          const membership = (await cached(ctx, `member-inspect:${userId}:${groupId}:n`, () =>
            ctx.runQuery(config.component.group.member.get, {
              userId,
              groupId,
            }),
          )) as MemberDocLike;
          if (membership === null) {
            return {
              membership: null,
              roleIds: [] as string[],
              grants: [] as string[],
            };
          }
          const membershipRoleIds = membership.roleIds ?? [];
          const membershipGrants = capGrantsForCaller(
            oauthCaller,
            userId,
            resolveGrantedPermissions(membershipRoleIds),
          );
          return {
            membership,
            roleIds: membershipRoleIds,
            grants: membershipGrants,
          };
        }),
      );
    }

    const useAncestry = opts.ancestry === true;
    const maxDepth = useAncestry ? Math.max(0, Math.floor(opts.maxDepth ?? 32)) : 0;
    const cacheKey = `member-inspect:${opts.userId}:${opts.groupId}:${
      useAncestry ? `a${maxDepth}` : "n"
    }`;

    let membership: MemberDocLike = null;

    if (useAncestry) {
      const result = (await cached(ctx, cacheKey, () =>
        ctx.runQuery(config.component.group.member.resolve, {
          userId: opts.userId,
          groupId: opts.groupId,
          maxDepth,
          ancestry: true,
        }),
      )) as { membership: MemberDocLike };
      membership = result.membership;
    } else {
      const doc = (await cached(ctx, cacheKey, () =>
        ctx.runQuery(config.component.group.member.get, {
          userId: opts.userId,
          groupId: opts.groupId,
        }),
      )) as MemberDocLike;
      membership = doc;
    }

    if (membership === null) {
      return {
        membership: null,
        roleIds: [] as string[],
        grants: [] as string[],
      };
    }

    const membershipRoleIds = membership.roleIds ?? [];
    const membershipGrants = capGrantsForCaller(
      oauthCaller,
      opts.userId,
      resolveGrantedPermissions(membershipRoleIds),
    );

    return {
      membership,
      roleIds: membershipRoleIds,
      grants: membershipGrants,
    };
  }

  const member = {
    /**
     * Add a user to a group with optional role IDs.
     *
     * Role IDs are validated against the roles defined in `definePermissions()` —
     * invalid IDs throw `INVALID_ROLE_IDS`.
     * Throws `DUPLICATE_MEMBERSHIP` if the user is already a member.
     *
     * @param ctx - Convex mutation context.
     * @param opts.data.groupId - The group to add the user to.
     * @param opts.data.userId - The user's document ID.
     * @param opts.data.roleIds - Role IDs from `definePermissions()` (optional).
     * @param opts.data.status - Membership status string (optional, app-defined).
     * @param opts.data.extend - Arbitrary app-specific metadata.
     * @returns The created membership ID.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * const memberId = await auth.member.create(ctx, {
     *   data: {
     *     groupId: orgId,
     *     userId,
     *     roleIds: [roles.orgAdmin.id],
     *   },
     * });
     * ```
     */
    create: async (
      ctx: ComponentCtx,
      opts: {
        data: {
          groupId: string;
          userId: string;
          roleIds?: string[];
          status?: string;
          extend?: Record<string, unknown>;
        };
      },
    ) => {
      const data = opts.data;
      const roleIds = normalizeRoleIds(data.roleIds);
      const memberId = (await ctx.runMutation(config.component.group.member.create, {
        ...data,
        roleIds,
      })) as string;
      invalidateCtxCache(ctx, `member-inspect:${data.userId}:${data.groupId}`);
      return memberId;
    },
    /**
     * List memberships with optional filtering and pagination.
     *
     * Supports filtering by `groupId`, `userId`, and `status`.
     * When `groupId` and `status` are both provided, a compound index
     * is used for efficient queries.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional).
     * @param opts.paginationOpts - Convex pagination options.
     * @param opts.orderBy - Sort field: `"_creationTime"` or `"status"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns Convex `PaginationResult` — `{ page, isDone, continueCursor }`.
     *
     * @example
     * ```ts
     * const { page } = await auth.member.list(ctx, {
     *   where: { groupId: orgId },
     *   paginationOpts: { numItems: 20, cursor: null },
     *   orderBy: "_creationTime",
     *   order: "asc",
     * });
     * ```
     */
    list: async <O extends MemberListOpts | undefined = undefined>(
      ctx: ComponentReadCtx,
      opts?: O,
    ): Promise<Paginated<MemberItem<NonNullable<O>>>> => {
      const page = (await ctx.runQuery(config.component.group.member.list, {
        where: opts?.where,
        paginationOpts: opts?.paginationOpts ?? { numItems: 50, cursor: null },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"GroupMember">>;
      if (opts?.withGroup !== true && opts?.withGrants !== true) {
        return page as Paginated<MemberItem<NonNullable<O>>>;
      }
      const groupDocs = opts?.withGroup
        ? await groupGet(ctx, { ids: page.page.map((m) => m.groupId) })
        : null;
      const oauthCaller = opts?.withGrants === true ? await resolveOAuthCaller(ctx) : null;
      const enrichedItems = await Promise.all(
        page.page.map(async (m, i) => {
          let enriched: Record<string, unknown> = { ...m };
          if (groupDocs !== null) {
            enriched.group = groupDocs[i] ?? null;
          }
          if (opts?.withGrants === true) {
            const roleIds = m.roleIds ?? [];
            enriched.roleIds = roleIds;
            enriched.grants = capGrantsForCaller(
              oauthCaller,
              m.userId,
              resolveGrantedPermissions(roleIds),
            );
          }
          return enriched;
        }),
      );
      return {
        ...page,
        page: enrichedItems as Array<MemberItem<NonNullable<O>>>,
      };
    },
    /**
     * Remove a membership by its document ID.
     *
     * @param ctx - Convex mutation context.
     * @param opts.id - The membership document ID.
     * @returns `null`.
     *
     * @example
     * ```ts
     * await auth.member.remove(ctx, { id: memberId });
     * ```
     */
    remove: async (ctx: ComponentCtx, opts: { id: string }) => {
      await ctx.runMutation(config.component.group.member.remove, { id: opts.id });
      invalidateCtxCache(ctx, "member");
      invalidateCtxCache(ctx, "member-inspect");
      return null;
    },
    /**
     * Patch a membership's `roleIds`, `status`, or `extend` fields.
     * Role IDs are validated against `definePermissions()`.
     *
     * @param ctx - Convex mutation context.
     * @param opts.id - The membership document ID.
     * @param opts.patch - Fields to merge. `roleIds` are validated.
     * @returns `null`.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * await auth.member.update(ctx, {
     *   id: memberId,
     *   patch: {
     *     roleIds: [roles.orgAdmin.id],
     *     status: "active",
     *   },
     * });
     * ```
     */
    update: async (ctx: ComponentCtx, opts: { id: string; patch: Record<string, unknown> }) => {
      const nextData = { ...opts.patch };
      if ("roleIds" in nextData) {
        nextData.roleIds = normalizeRoleIds(
          Array.isArray(nextData.roleIds) ? (nextData.roleIds as string[]) : undefined,
        );
      }
      await ctx.runMutation(config.component.group.member.update, {
        id: opts.id,
        patch: nextData,
      });
      invalidateCtxCache(ctx, `member:${opts.id}`);
      invalidateCtxCache(ctx, "member-inspect");
      return null;
    },
    /**
     * Resolve a user's membership in a group, optionally walking the
     * hierarchy and checking grants.
     *
     * **Default (no flags):** Direct lookup at `groupId` only — fast,
     * 1 component read. Replaces the old `getByUserAndGroup`.
     *
     * **`ancestry: true`:** Walk the group hierarchy from `groupId` up
     * to root, returning the first matching membership. Includes
     * `traversedGroupIds` in the result. Expensive (N reads).
     *
     * **`grants: [...]`:** Check if the user has all specified grants.
     * Works at the direct level by default. Combine with
     * `ancestry: true` to check inherited grants.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.userId - The user's document ID.
     * @param opts.groupId - The group to check membership in.
     * @param opts.ancestry - Walk the hierarchy (default `false`).
     * @param opts.maxDepth - Max hierarchy levels (default 32, only with ancestry).
     * @returns `{ membership, roleIds, grants }`.
     *
     * @example Direct lookup
     * ```ts
     * const result = await auth.member.get(ctx, { userId, groupId });
     * if (!result.membership) return null;
     * ```
     *
     * @example Check grants after inspection
     * ```ts
     * const result = await auth.member.get(ctx, {
     *   userId, groupId,
     * });
     * const canCreate = result.grants.includes("issues.create");
     * ```
     *
     * @example Walk hierarchy + check grants
     * ```ts
     * const result = await auth.member.get(ctx, {
     *   userId, groupId: teamId, ancestry: true,
     * });
     * ```
     *
     * @example Batched across many groups (one RPC)
     * ```ts
     * const resolutions = await auth.member.get(ctx, {
     *   userId, groupIds: rootGroupIds,
     * });
     * ```
     */
    get: memberInspect,
    assert: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: string;
        groupId: string;
        ancestry?: boolean;
        roleIds?: string[];
        grants?: string[];
        maxDepth?: number;
      },
    ) => {
      const validatedRoleIds = normalizeRoleIds(opts.roleIds);
      const requiredGrants = Array.from(new Set(opts.grants ?? []));
      const roleFilter = validatedRoleIds.length > 0 ? new Set(validatedRoleIds) : null;
      const result: InspectResult = await memberInspect(ctx, {
        userId: opts.userId,
        groupId: opts.groupId,
        ancestry: opts.ancestry,
        maxDepth: opts.maxDepth,
      });
      if (result.membership === null) {
        throw new ConvexError({
          code: ErrorCode.NOT_A_MEMBER,
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      if (roleFilter !== null && !result.roleIds.some((roleId: string) => roleFilter.has(roleId))) {
        throw new ConvexError({
          code: ErrorCode.NOT_A_MEMBER,
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      const missingGrants = requiredGrants.filter((grant) => !result.grants.includes(grant));
      if (missingGrants.length > 0) {
        throw new ConvexError({
          code: ErrorCode.MISSING_GRANTS,
          message: "User is missing required grants.",
          groupId: opts.groupId,
          missingGrants,
        });
      }
      return result;
    },
  };

  return member;
}
