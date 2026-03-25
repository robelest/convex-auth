import { Auth, GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";

import {
  buildScopeChecker,
  checkKeyRateLimit,
  generateApiKey,
  hashApiKey,
} from "../keys";
import { materializeProvider } from "../providers";
import { signInImpl } from "../signin";
import type {
  AuthProviderConfig,
  KeyDoc,
  KeyScope,
  ScopeChecker,
  UserOrderBy,
  UserWhere,
} from "../types";
import {
  generateRandomString,
  sha256,
  TOKEN_SUB_CLAIM_DIVIDER,
} from "../utils";

type ComponentCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type ComponentAuthReadCtx = ComponentReadCtx & { auth: Auth };
type AccountCredentials = { id: string; secret?: string };
type CreateAccountArgs = {
  provider: string;
  account: AccountCredentials;
  profile: Record<string, unknown>;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};
type RetrieveAccountArgs = { provider: string; account: AccountCredentials };
type UpdateAccountCredentialsArgs = {
  provider: string;
  account: { id: string; secret: string };
};

type CoreDeps = {
  config: any;
  getAuth: () => any;
  callInvalidateSessions: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: { userId: GenericId<"User">; except?: GenericId<"Session">[] },
  ) => Promise<void>;
  callCreateAccountFromCredentials: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: CreateAccountArgs,
  ) => Promise<any>;
  callRetrieveAccountWithCredentials: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: RetrieveAccountArgs,
  ) => Promise<any>;
  callModifyAccount: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: UpdateAccountCredentialsArgs,
  ) => Promise<void>;
  getEnrichCtx: () => <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => any;
  inviteTokenAlphabet: string;
  inviteTokenLength: number;
};

/**
 * Build the core auth domains that back the canonical app API surface.
 */
export function createCoreDomains(deps: CoreDeps) {
  const {
    config,
    getAuth,
    callInvalidateSessions,
    callCreateAccountFromCredentials,
    callRetrieveAccountWithCredentials,
    callModifyAccount,
    getEnrichCtx,
    inviteTokenAlphabet,
    inviteTokenLength,
  } = deps;

  const roleDefinitions = config.authorization.roles as Record<
    string,
    { label?: string; grants: string[] }
  >;

  const getRoleDefinition = (roleId: string) => {
    return roleDefinitions[roleId] ?? null;
  };

  const normalizeRoleIds = (
    roleIds?: string[],
  ):
    | { ok: true; roleIds: string[] }
    | { ok: false; invalidRoleIds: string[] } => {
    const normalized = Array.from(new Set(roleIds ?? []));
    const invalid = normalized.filter((id) => getRoleDefinition(id) === null);
    if (invalid.length > 0) {
      return { ok: false, invalidRoleIds: invalid };
    }
    return { ok: true, roleIds: normalized };
  };

  const resolveGrantedPermissions = (roleIds?: string[]) => {
    const grants = new Set<string>();
    for (const roleId of roleIds ?? []) {
      const role = getRoleDefinition(roleId);
      if (role === null) continue;
      for (const grant of role.grants) {
        grants.add(grant);
      }
    }
    return Array.from(grants).sort();
  };

  // Per-execution cache — attached to ctx so each function invocation has its own.
  // Eliminates redundant cross-component RPCs for the same entity within a handler.
  type CtxCache = {
    users: Map<string, any>;
    groups: Map<string, any>;
  };
  const AUTH_CACHE = Symbol("__convexAuthCache");
  function cache(ctx: any): CtxCache {
    if (!ctx[AUTH_CACHE]) {
      ctx[AUTH_CACHE] = {
        users: new Map(),
        groups: new Map(),
      } satisfies CtxCache;
    }
    return ctx[AUTH_CACHE];
  }

  const user = {
    id: async (
      ctx: { auth: Auth } & Partial<ComponentCtx>,
      request?: Request,
    ): Promise<string | null> => {
      const identity = await ctx.auth.getUserIdentity();
      if (identity !== null) {
        const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return userId;
      }
      if (request !== undefined && "runMutation" in ctx && ctx.runMutation) {
        const authHeader = request.headers.get("Authorization");
        if (authHeader?.startsWith("Bearer sk_")) {
          const rawKey = authHeader.slice(7);
          const result = await getAuth().key.verify(
            ctx as ComponentCtx,
            rawKey,
          );
          if (result.ok) {
            return result.userId;
          }
          return null;
        }
      }
      return null;
    },
    get: async (ctx: ComponentReadCtx, userId: string) => {
      const c = cache(ctx);
      if (c.users.has(userId)) return c.users.get(userId);
      const result = await ctx.runQuery(config.component.public.userGetById, {
        userId,
      });
      c.users.set(userId, result);
      return result;
    },
    list: async (
      ctx: ComponentReadCtx,
      opts: {
        where?: UserWhere;
        limit?: number;
        cursor?: string | null;
        orderBy?: UserOrderBy;
        order?: "asc" | "desc";
      } = {},
    ) => {
      return await ctx.runQuery(config.component.public.userList, opts);
    },
    viewer: async (ctx: ComponentAuthReadCtx) => {
      const userId = await user.id(ctx);
      if (userId === null) return null;
      return await user.get(ctx, userId);
    },
    update: async (
      ctx: ComponentCtx,
      userId: string,
      data: Record<string, unknown>,
    ) => {
      await ctx.runMutation(config.component.public.userPatch, {
        userId,
        data,
      });
      return { ok: true as const, userId };
    },
    setActiveGroup: async (
      ctx: ComponentCtx,
      opts: { userId: string; groupId: string | null },
    ) => {
      const doc = await user.get(ctx, opts.userId);
      const existingExtend =
        doc !== null &&
        doc.extend !== null &&
        typeof doc.extend === "object" &&
        !Array.isArray(doc.extend)
          ? { ...(doc.extend as Record<string, unknown>) }
          : {};
      if (opts.groupId === null) {
        const { lastActiveGroup: _omit, ...rest } = existingExtend;
        await user.update(ctx, opts.userId, { extend: rest });
        return { ok: true as const, userId: opts.userId, groupId: null };
      }
      await user.update(ctx, opts.userId, {
        extend: { ...existingExtend, lastActiveGroup: opts.groupId },
      });
      return { ok: true as const, userId: opts.userId, groupId: opts.groupId };
    },
    getActiveGroup: async (
      ctx: ComponentReadCtx,
      opts: { userId: string },
    ): Promise<string | null> => {
      const doc = await user.get(ctx, opts.userId);
      if (
        doc !== null &&
        doc.extend !== null &&
        typeof doc.extend === "object" &&
        !Array.isArray(doc.extend)
      ) {
        const val = (doc.extend as Record<string, unknown>).lastActiveGroup;
        if (typeof val === "string") return val;
      }
      return null;
    },
    delete: async (
      ctx: ComponentCtx,
      userId: string,
      opts?: { cascade?: boolean },
    ) => {
      const cascade = opts?.cascade !== false;
      const [sessions, accounts, keys, members, passkeys, totps] =
        await Promise.all([
          ctx.runQuery(config.component.public.sessionListByUser, {
            userId,
          }) as Promise<Array<{ _id: string }>>,
          ctx.runQuery(config.component.public.accountListByUser, {
            userId,
          }) as Promise<Array<{ _id: string }>>,
          ctx.runQuery(config.component.public.keyListByUserId, {
            userId,
          }) as Promise<Array<{ _id: string }>>,
          ctx.runQuery(config.component.public.memberListByUser, {
            userId,
          }) as Promise<Array<{ _id: string }>>,
          ctx.runQuery(config.component.public.passkeyListByUserId, {
            userId,
          }) as Promise<Array<{ _id: string }>>,
          ctx.runQuery(config.component.public.totpListByUserId, {
            userId,
          }) as Promise<Array<{ _id: string }>>,
        ]);
      const totalLinked =
        sessions.length +
        accounts.length +
        keys.length +
        members.length +
        passkeys.length +
        totps.length;
      if (!cascade && totalLinked > 0) {
        return { ok: false as const, code: "INVALID_PARAMETERS" as const };
      }
      const deletions: Promise<unknown>[] = [];
      for (const s of sessions)
        deletions.push(
          ctx.runMutation(config.component.public.sessionDelete, {
            sessionId: s._id,
          }),
        );
      for (const a of accounts)
        deletions.push(
          ctx.runMutation(config.component.public.accountDelete, {
            accountId: a._id,
          }),
        );
      for (const k of keys)
        deletions.push(
          ctx.runMutation(config.component.public.keyDelete, { keyId: k._id }),
        );
      for (const m of members)
        deletions.push(
          ctx.runMutation(config.component.public.memberRemove, {
            memberId: m._id,
          }),
        );
      for (const p of passkeys)
        deletions.push(
          ctx.runMutation(config.component.public.passkeyDelete, {
            passkeyId: p._id,
          }),
        );
      for (const t of totps)
        deletions.push(
          ctx.runMutation(config.component.public.totpDelete, {
            totpId: t._id,
          }),
        );
      await Promise.all(deletions);
      await ctx.runMutation(config.component.public.userDelete, { userId });
      return { ok: true as const, userId };
    },
  };

  const session = {
    current: async (ctx: { auth: Auth }) => {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) return null;
      const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
      return sessionId as GenericId<"Session">;
    },
    invalidate: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: { userId: GenericId<"User">; except?: GenericId<"Session">[] },
    ) => {
      await callInvalidateSessions(ctx, args);
      return {
        ok: true as const,
        userId: args.userId,
        except: args.except ?? [],
      };
    },
    get: async (ctx: ComponentReadCtx, sessionId: string) => {
      return await ctx.runQuery(config.component.public.sessionGetById, {
        sessionId,
      });
    },
    list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(config.component.public.sessionListByUser, {
        userId: opts.userId,
      });
    },
  };

  const account = {
    create: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: CreateAccountArgs,
    ) => {
      const created = await callCreateAccountFromCredentials(ctx, args);
      return { ok: true as const, ...created };
    },
    get: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: RetrieveAccountArgs,
    ) => {
      const result = await callRetrieveAccountWithCredentials(ctx, args);
      if (typeof result === "string") {
        return null;
      }
      return result;
    },
    update: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: UpdateAccountCredentialsArgs,
    ) => {
      await callModifyAccount(ctx, args);
      return { ok: true as const, accountId: args.account.id };
    },
    delete: async (ctx: ComponentCtx, accountId: string) => {
      const doc = await ctx.runQuery(config.component.public.accountGetById, {
        accountId,
      });
      if (doc === null) {
        return { ok: false as const, code: "ACCOUNT_NOT_FOUND" as const };
      }
      const allAccounts = (await ctx.runQuery(
        config.component.public.accountListByUser,
        { userId: (doc as any).userId },
      )) as Array<{ _id: string }>;
      if (allAccounts.length <= 1) {
        return { ok: false as const, code: "INVALID_PARAMETERS" as const };
      }
      await ctx.runMutation(config.component.public.accountDelete, {
        accountId,
      });
      return { ok: true as const, accountId };
    },
    listPasskeys: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(
        config.component.public.passkeyListByUserId,
        opts,
      );
    },
    renamePasskey: async (
      ctx: ComponentCtx,
      passkeyId: string,
      name: string,
    ) => {
      await ctx.runMutation(config.component.public.passkeyUpdateMeta, {
        passkeyId,
        data: { name },
      });
      return { ok: true as const, passkeyId };
    },
    deletePasskey: async (ctx: ComponentCtx, passkeyId: string) => {
      await ctx.runMutation(config.component.public.passkeyDelete, {
        passkeyId,
      });
      return { ok: true as const, passkeyId };
    },
    listTotps: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(config.component.public.totpListByUserId, opts);
    },
    deleteTotp: async (ctx: ComponentCtx, totpId: string) => {
      await ctx.runMutation(config.component.public.totpDelete, { totpId });
      return { ok: true as const, totpId };
    },
  };

  const provider = {
    signIn: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      providerConfig: AuthProviderConfig,
      args: {
        accountId?: GenericId<"Account">;
        params?: Record<string, unknown>;
      },
    ) => {
      const result = await signInImpl(
        getEnrichCtx()(ctx),
        materializeProvider(providerConfig),
        args as {
          accountId?: GenericId<"Account">;
          params?: Record<string, any>;
        },
        { generateTokens: false, allowExtraProviders: true },
      );
      return result.kind === "signedIn"
        ? result.signedIn !== null
          ? {
              userId: result.signedIn.userId,
              sessionId: result.signedIn.sessionId,
            }
          : null
        : null;
    },
  };

  const group = {
    create: async (
      ctx: ComponentCtx,
      data: {
        name: string;
        slug?: string;
        type?: string;
        parentGroupId?: string;
        tags?: Array<{ key: string; value: string }>;
        extend?: Record<string, unknown>;
      },
    ): Promise<{ ok: true; groupId: string }> => {
      const groupId = (await ctx.runMutation(
        config.component.public.groupCreate,
        data,
      )) as string;
      return { ok: true, groupId };
    },
    get: async (ctx: ComponentReadCtx, groupId: string) => {
      const c = cache(ctx);
      if (c.groups.has(groupId)) return c.groups.get(groupId);
      const result = await ctx.runQuery(config.component.public.groupGet, {
        groupId,
      });
      c.groups.set(groupId, result);
      return result;
    },
    list: async (
      ctx: ComponentReadCtx,
      opts?: {
        where?: {
          slug?: string;
          type?: string;
          parentGroupId?: string;
          name?: string;
          isRoot?: boolean;
          tagsAll?: Array<{ key: string; value: string }>;
          tagsAny?: Array<{ key: string; value: string }>;
        };
        limit?: number;
        cursor?: string | null;
        orderBy?: "_creationTime" | "name" | "slug" | "type";
        order?: "asc" | "desc";
      },
    ) => {
      return await ctx.runQuery(config.component.public.groupList, {
        where: opts?.where,
        limit: opts?.limit,
        cursor: opts?.cursor,
        orderBy: opts?.orderBy,
        order: opts?.order,
      });
    },
    update: async (
      ctx: ComponentCtx,
      groupId: string,
      data: Record<string, unknown>,
    ) => {
      await ctx.runMutation(config.component.public.groupUpdate, {
        groupId,
        data,
      });
      return { ok: true as const, groupId };
    },
    delete: async (ctx: ComponentCtx, groupId: string) => {
      await ctx.runMutation(config.component.public.groupDelete, { groupId });
      return { ok: true as const, groupId };
    },
    ancestors: async (
      ctx: ComponentReadCtx,
      opts: { groupId: string; maxDepth?: number; includeSelf?: boolean },
    ) => {
      const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));
      const visited = new Set<string>();
      const ancestors: any[] = [];
      let cycleDetected = false;
      let maxDepthReached = false;
      let currentGroupId: string | undefined = opts.groupId;
      let depth = 0;
      let isFirst = true;
      while (currentGroupId !== undefined) {
        if (depth > maxDepth) {
          maxDepthReached = true;
          break;
        }
        if (visited.has(currentGroupId)) {
          cycleDetected = true;
          break;
        }
        visited.add(currentGroupId);
        const doc = await group.get(ctx, currentGroupId);
        if (doc === null) break;
        if (isFirst) {
          isFirst = false;
          if (opts.includeSelf) ancestors.push(doc);
          currentGroupId = doc.parentGroupId;
          depth += 1;
          continue;
        }
        ancestors.push(doc);
        currentGroupId = doc.parentGroupId;
        depth += 1;
      }
      return { ancestors, cycleDetected, maxDepthReached };
    },
  };

  const member = {
    create: async (
      ctx: ComponentCtx,
      data: {
        groupId: string;
        userId: string;
        roleIds?: string[];
        status?: string;
        extend?: Record<string, unknown>;
      },
    ) => {
      const normalized = normalizeRoleIds(data.roleIds);
      if (!normalized.ok)
        return {
          ok: false as const,
          code: "INVALID_ROLE_IDS" as const,
          invalidRoleIds: normalized.invalidRoleIds,
        };
      const memberId = (await ctx.runMutation(
        config.component.public.memberAdd,
        { ...data, roleIds: normalized.roleIds },
      )) as string;
      return { ok: true as const, memberId };
    },
    get: async (ctx: ComponentReadCtx, memberId: string) => {
      return await ctx.runQuery(config.component.public.memberGet, {
        memberId,
      });
    },
    getByUserAndGroup: async (
      ctx: ComponentReadCtx,
      opts: { userId: string; groupId: string },
    ) => {
      return await ctx.runQuery(
        config.component.public.memberGetByGroupAndUser,
        opts,
      );
    },
    list: async (
      ctx: ComponentReadCtx,
      opts?: {
        where?: {
          groupId?: string;
          userId?: string;
          roleId?: string;
          status?: string;
        };
        limit?: number;
        cursor?: string | null;
        orderBy?: "_creationTime" | "status";
        order?: "asc" | "desc";
      },
    ) => {
      return await ctx.runQuery(config.component.public.memberList, {
        where: opts?.where,
        limit: opts?.limit,
        cursor: opts?.cursor,
        orderBy: opts?.orderBy,
        order: opts?.order,
      });
    },
    delete: async (ctx: ComponentCtx, memberId: string) => {
      await ctx.runMutation(config.component.public.memberRemove, { memberId });
      return { ok: true as const, memberId };
    },
    update: async (
      ctx: ComponentCtx,
      memberId: string,
      data: Record<string, unknown>,
    ) => {
      const nextData = { ...data };
      if ("roleIds" in nextData) {
        const normalized = normalizeRoleIds(
          Array.isArray(nextData.roleIds)
            ? (nextData.roleIds as string[])
            : undefined,
        );
        if (!normalized.ok)
          return {
            ok: false as const,
            code: "INVALID_ROLE_IDS" as const,
            invalidRoleIds: normalized.invalidRoleIds,
          };
        nextData.roleIds = normalized.roleIds;
      }
      await ctx.runMutation(config.component.public.memberUpdate, {
        memberId,
        data: nextData,
      });
      return { ok: true as const, memberId };
    },
    resolve: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: string;
        groupId: string;
        roleIds?: string[];
        grants?: string[];
        maxDepth?: number;
      },
    ) => {
      const normalized = normalizeRoleIds(opts.roleIds);
      if (!normalized.ok)
        return {
          ok: false as const,
          code: "INVALID_ROLE_IDS" as const,
          invalidRoleIds: normalized.invalidRoleIds,
        };
      const requestedRoleIds = normalized.roleIds;
      const roleFilter =
        requestedRoleIds.length > 0 ? new Set(requestedRoleIds) : null;
      const requiredGrants = Array.from(new Set(opts.grants ?? []));
      const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));

      // Single cross-component RPC — hierarchy walk happens inside the component
      const result = await ctx.runQuery(config.component.public.memberResolve, {
        userId: opts.userId,
        groupId: opts.groupId,
        maxDepth,
        ancestry: true,
      });

      const traversedGroupIds = result.traversedGroupIds ?? [];

      if (result.membership === null) {
        return {
          requestedGroupId: opts.groupId,
          matchedGroupId: null,
          membership: null,
          roleIds: [] as string[],
          grants: [] as string[],
          missingGrants: requiredGrants,
          depth: null,
          isDirect: false,
          isInherited: false,
          traversedGroupIds,
          cycleDetected: false,
          maxDepthReached: false,
        };
      }

      // Grant resolution uses app-defined roles — stays server-side
      const membershipRoleIds = (result.membership as any).roleIds ?? [];
      const membershipGrants = resolveGrantedPermissions(membershipRoleIds);

      // Check role filter
      if (
        roleFilter !== null &&
        !membershipRoleIds.some((roleId: string) => roleFilter.has(roleId))
      ) {
        return {
          requestedGroupId: opts.groupId,
          matchedGroupId: null,
          membership: null,
          roleIds: [] as string[],
          grants: [] as string[],
          missingGrants: requiredGrants,
          depth: null,
          isDirect: false,
          isInherited: false,
          traversedGroupIds,
          cycleDetected: false,
          maxDepthReached: false,
        };
      }

      // Check required grants
      const missingGrants = requiredGrants.filter(
        (grant) => !membershipGrants.includes(grant),
      );
      if (missingGrants.length > 0) {
        return {
          requestedGroupId: opts.groupId,
          matchedGroupId: result.matchedGroupId,
          membership: result.membership,
          roleIds: membershipRoleIds,
          grants: membershipGrants,
          missingGrants,
          depth: result.depth,
          isDirect: result.isDirect,
          isInherited: result.isInherited,
          traversedGroupIds,
          cycleDetected: false,
          maxDepthReached: false,
        };
      }

      return {
        requestedGroupId: opts.groupId,
        matchedGroupId: result.matchedGroupId,
        membership: result.membership,
        roleIds: membershipRoleIds,
        grants: membershipGrants,
        missingGrants: [] as string[],
        depth: result.depth,
        isDirect: result.isDirect,
        isInherited: result.isInherited,
        traversedGroupIds,
        cycleDetected: false,
        maxDepthReached: false,
      };
    },
  };

  const access = {
    check: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: string;
        groupId: string;
        grants: string[];
        maxDepth?: number;
      },
    ) => {
      const requiredGrants = Array.from(new Set(opts.grants));
      const result = await member.resolve(ctx, {
        userId: opts.userId,
        groupId: opts.groupId,
        grants: requiredGrants,
        maxDepth: opts.maxDepth,
      });
      if ("code" in result && result.code === "INVALID_ROLE_IDS") {
        return {
          ok: false,
          membership: null,
          matchedGroupId: null,
          roleIds: [] as string[],
          grants: [] as string[],
          missingGrants: requiredGrants,
          isDirect: false,
          isInherited: false,
          depth: null,
        };
      }
      const missingGrants = requiredGrants.filter(
        (grant) => !result.grants.includes(grant),
      );
      return {
        ok: result.membership !== null && missingGrants.length === 0,
        membership: result.membership,
        matchedGroupId: result.matchedGroupId,
        roleIds: result.roleIds,
        grants: result.grants,
        missingGrants,
        isDirect: result.isDirect,
        isInherited: result.isInherited,
        depth: result.depth,
      };
    },
  };

  const invite = {
    create: async (
      ctx: ComponentCtx,
      data: {
        groupId?: string;
        invitedByUserId?: string;
        email?: string;
        roleIds?: string[];
        expiresTime?: number;
        extend?: Record<string, unknown>;
      },
    ) => {
      const normalized = normalizeRoleIds(data.roleIds);
      if (!normalized.ok)
        return {
          ok: false as const,
          code: "INVALID_ROLE_IDS" as const,
          invalidRoleIds: normalized.invalidRoleIds,
        };
      const token = generateRandomString(
        inviteTokenLength,
        inviteTokenAlphabet,
      );
      const tokenHash = await sha256(token);
      const inviteId = (await ctx.runMutation(
        config.component.public.inviteCreate,
        { ...data, roleIds: normalized.roleIds, tokenHash, status: "pending" },
      )) as string;
      return { ok: true as const, inviteId, token };
    },
    get: async (ctx: ComponentReadCtx, inviteId: string) => {
      return await ctx.runQuery(config.component.public.inviteGet, {
        inviteId,
      });
    },
    token: {
      get: async (ctx: ComponentReadCtx, token: string) => {
        const tokenHash = await sha256(token);
        return await ctx.runQuery(
          config.component.public.inviteGetByTokenHash,
          { tokenHash },
        );
      },
      accept: async (
        ctx: ComponentCtx,
        args: { token: string; acceptedByUserId: string },
      ) => {
        const tokenHash = await sha256(args.token);
        const result = await ctx.runMutation(
          config.component.public.inviteAcceptByToken,
          { tokenHash, acceptedByUserId: args.acceptedByUserId },
        );
        return { ok: true as const, ...result };
      },
    },
    list: async (
      ctx: ComponentReadCtx,
      opts?: {
        where?: {
          tokenHash?: string;
          groupId?: string;
          status?: "pending" | "accepted" | "revoked" | "expired";
          email?: string;
          invitedByUserId?: string;
          roleId?: string;
          acceptedByUserId?: string;
        };
        limit?: number;
        cursor?: string | null;
        orderBy?:
          | "_creationTime"
          | "status"
          | "email"
          | "expiresTime"
          | "acceptedTime";
        order?: "asc" | "desc";
      },
    ) => {
      return await ctx.runQuery(config.component.public.inviteList, {
        where: opts?.where,
        limit: opts?.limit,
        cursor: opts?.cursor,
        orderBy: opts?.orderBy,
        order: opts?.order,
      });
    },
    accept: async (
      ctx: ComponentCtx,
      inviteId: string,
      acceptedByUserId?: string,
    ) => {
      await ctx.runMutation(config.component.public.inviteAccept, {
        inviteId,
        ...(acceptedByUserId ? { acceptedByUserId } : {}),
      });
      return {
        ok: true as const,
        inviteId,
        acceptedByUserId: acceptedByUserId ?? null,
      };
    },
    revoke: async (ctx: ComponentCtx, inviteId: string) => {
      await ctx.runMutation(config.component.public.inviteRevoke, { inviteId });
      return { ok: true as const, inviteId };
    },
  };

  const key = {
    create: async (
      ctx: ComponentCtx,
      opts: {
        userId: string;
        name: string;
        scopes: KeyScope[];
        rateLimit?: { maxRequests: number; windowMs: number };
        expiresAt?: number;
        metadata?: Record<string, unknown>;
      },
    ): Promise<{ ok: true; keyId: string; secret: string }> => {
      const { raw, hashedKey, displayPrefix } = await generateApiKey("sk_");
      const keyId = (await ctx.runMutation(config.component.public.keyInsert, {
        userId: opts.userId,
        prefix: displayPrefix,
        hashedKey,
        name: opts.name,
        scopes: opts.scopes,
        rateLimit: opts.rateLimit,
        expiresAt: opts.expiresAt,
        metadata: opts.metadata,
      })) as string;
      return { ok: true, keyId, secret: raw };
    },
    verify: async (
      ctx: ComponentCtx,
      rawKey: string,
    ): Promise<
      | { ok: true; userId: string; keyId: string; scopes: ScopeChecker }
      | {
          ok: false;
          code:
            | "INVALID_API_KEY"
            | "API_KEY_REVOKED"
            | "API_KEY_EXPIRED"
            | "API_KEY_RATE_LIMITED";
        }
    > => {
      const hashedKey = await hashApiKey(rawKey);
      const doc = (await ctx.runQuery(
        config.component.public.keyGetByHashedKey,
        { hashedKey },
      )) as KeyDoc | null;
      if (!doc) {
        return { ok: false as const, code: "INVALID_API_KEY" as const };
      }
      const k = doc;
      if (k.revoked) {
        return { ok: false as const, code: "API_KEY_REVOKED" as const };
      }
      if (k.expiresAt && k.expiresAt < Date.now()) {
        return { ok: false as const, code: "API_KEY_EXPIRED" as const };
      }
      const patchData: Record<string, unknown> = { lastUsedAt: Date.now() };
      if (k.rateLimit) {
        const { limited, newState } = checkKeyRateLimit(
          k.rateLimit,
          k.rateLimitState ?? undefined,
        );
        if (limited) {
          return { ok: false as const, code: "API_KEY_RATE_LIMITED" as const };
        }
        patchData.rateLimitState = newState;
      }
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId: k._id,
        data: patchData,
      });
      return {
        ok: true as const,
        userId: k.userId,
        keyId: k._id,
        scopes: buildScopeChecker(k.scopes),
      };
    },
    list: async (
      ctx: ComponentReadCtx,
      opts?: {
        where?: {
          userId?: string;
          revoked?: boolean;
          name?: string;
          prefix?: string;
        };
        limit?: number;
        cursor?: string | null;
        orderBy?:
          | "_creationTime"
          | "name"
          | "lastUsedAt"
          | "expiresAt"
          | "revoked";
        order?: "asc" | "desc";
      },
    ) => {
      return await ctx.runQuery(config.component.public.keyList, {
        where: opts?.where,
        limit: opts?.limit,
        cursor: opts?.cursor,
        orderBy: opts?.orderBy,
        order: opts?.order,
      });
    },
    get: async (
      ctx: ComponentReadCtx,
      keyId: string,
    ): Promise<KeyDoc | null> => {
      return (await ctx.runQuery(config.component.public.keyGetById, {
        keyId,
      })) as KeyDoc | null;
    },
    update: async (
      ctx: ComponentCtx,
      keyId: string,
      data: {
        name?: string;
        scopes?: KeyScope[];
        rateLimit?: { maxRequests: number; windowMs: number };
      },
    ) => {
      await ctx.runMutation(config.component.public.keyPatch, { keyId, data });
      return { ok: true as const, keyId };
    },
    revoke: async (ctx: ComponentCtx, keyId: string) => {
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId,
        data: { revoked: true },
      });
      return { ok: true as const, keyId };
    },
    delete: async (ctx: ComponentCtx, keyId: string) => {
      await ctx.runMutation(config.component.public.keyDelete, { keyId });
      return { ok: true as const, keyId };
    },
    rotate: async (
      ctx: ComponentCtx,
      keyId: string,
      opts?: { name?: string; expiresAt?: number },
    ): Promise<
      | { ok: true; keyId: string; secret: string }
      | { ok: false; code: "INVALID_PARAMETERS" | "API_KEY_REVOKED" }
    > => {
      const existing = await ctx.runQuery(config.component.public.keyGetById, {
        keyId,
      });
      if (!existing) {
        return { ok: false as const, code: "INVALID_PARAMETERS" as const };
      }
      if ((existing as any).revoked === true) {
        return { ok: false as const, code: "API_KEY_REVOKED" as const };
      }
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId,
        data: { revoked: true },
      });
      return await key.create(ctx, {
        userId: (existing as any).userId,
        name: opts?.name ?? (existing as any).name,
        scopes: (existing as any).scopes ?? [],
        rateLimit: (existing as any).rateLimit,
        expiresAt: opts?.expiresAt,
        metadata: (existing as any).metadata,
      });
    },
  };

  return {
    user,
    session,
    account,
    provider,
    group,
    member,
    access,
    invite,
    key,
  };
}
