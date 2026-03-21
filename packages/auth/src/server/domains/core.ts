import { Auth, GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";

import { AuthError, Fx } from "../fx";
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

  const user = {
    current: async (
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
          try {
            const result = await getAuth().key.verify(
              ctx as ComponentCtx,
              rawKey,
            );
            return result.userId;
          } catch {
            return null;
          }
        }
      }
      return null;
    },
    require: async (
      ctx: { auth: Auth } & Partial<ComponentCtx>,
      request?: Request,
    ): Promise<string> => {
      const userId = await user.current(ctx, request);
      if (userId === null) {
        throw new AuthError("NOT_SIGNED_IN").toConvexError();
      }
      return userId;
    },
    get: async (ctx: ComponentReadCtx, userId: string) => {
      return await ctx.runQuery(config.component.public.userGetById, {
        userId,
      });
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
      const userId = await user.current(ctx);
      if (userId === null) return null;
      return await ctx.runQuery(config.component.public.userGetById, {
        userId,
      });
    },
    patch: async (
      ctx: ComponentCtx,
      userId: string,
      data: Record<string, unknown>,
    ) => {
      await ctx.runMutation(config.component.public.userPatch, {
        userId,
        data,
      });
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
        await user.patch(ctx, opts.userId, { extend: rest });
        return;
      }
      await user.patch(ctx, opts.userId, {
        extend: { ...existingExtend, lastActiveGroup: opts.groupId },
      });
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
    remove: async (
      ctx: ComponentCtx,
      userId: string,
      opts?: { cascade?: boolean },
    ): Promise<void> => {
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
        throw new AuthError(
          "INVALID_PARAMETERS",
          `Cannot delete user with ${totalLinked} linked records. Pass { cascade: true } to delete all linked records, or remove them manually first.`,
        ).toConvexError();
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
    ) => callInvalidateSessions(ctx, args),
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
      return await callCreateAccountFromCredentials(ctx, args);
    },
    get: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: RetrieveAccountArgs,
    ) => {
      const result = await callRetrieveAccountWithCredentials(ctx, args);
      if (typeof result === "string") {
        throw new AuthError("ACCOUNT_NOT_FOUND", result).toConvexError();
      }
      return result;
    },
    update: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: UpdateAccountCredentialsArgs,
    ): Promise<void> => {
      return await callModifyAccount(ctx, args);
    },
    remove: async (ctx: ComponentCtx, accountId: string): Promise<void> => {
      const doc = await ctx.runQuery(config.component.public.accountGetById, {
        accountId,
      });
      if (doc === null) {
        throw new AuthError(
          "ACCOUNT_NOT_FOUND",
          "Account not found.",
        ).toConvexError();
      }
      const allAccounts = (await ctx.runQuery(
        config.component.public.accountListByUser,
        { userId: (doc as any).userId },
      )) as Array<{ _id: string }>;
      if (allAccounts.length <= 1) {
        throw new AuthError(
          "INVALID_PARAMETERS",
          "Cannot unlink the user's only account. This would lock them out.",
        ).toConvexError();
      }
      await ctx.runMutation(config.component.public.accountDelete, {
        accountId,
      });
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
    },
    removePasskey: async (ctx: ComponentCtx, passkeyId: string) => {
      await ctx.runMutation(config.component.public.passkeyDelete, {
        passkeyId,
      });
    },
    listTotps: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(config.component.public.totpListByUserId, opts);
    },
    removeTotp: async (ctx: ComponentCtx, totpId: string) => {
      await ctx.runMutation(config.component.public.totpDelete, { totpId });
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
    ): Promise<string> => {
      return (await ctx.runMutation(
        config.component.public.groupCreate,
        data,
      )) as string;
    },
    get: async (ctx: ComponentReadCtx, groupId: string) => {
      return await ctx.runQuery(config.component.public.groupGet, { groupId });
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
    },
    delete: async (ctx: ComponentCtx, groupId: string) => {
      await ctx.runMutation(config.component.public.groupDelete, { groupId });
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
    add: async (
      ctx: ComponentCtx,
      data: {
        groupId: string;
        userId: string;
        role?: string;
        status?: string;
        extend?: Record<string, unknown>;
      },
    ): Promise<string> => {
      return (await ctx.runMutation(
        config.component.public.memberAdd,
        data,
      )) as string;
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
          role?: string;
          status?: string;
        };
        limit?: number;
        cursor?: string | null;
        orderBy?: "_creationTime" | "role" | "status";
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
    remove: async (ctx: ComponentCtx, memberId: string) => {
      await ctx.runMutation(config.component.public.memberRemove, { memberId });
    },
    update: async (
      ctx: ComponentCtx,
      memberId: string,
      data: Record<string, unknown>,
    ) => {
      await ctx.runMutation(config.component.public.memberUpdate, {
        memberId,
        data,
      });
    },
    inherit: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: string;
        groupId: string;
        roles?: string[];
        maxDepth?: number;
      },
    ) => {
      const roleFilter =
        opts.roles !== undefined && opts.roles.length > 0
          ? new Set(opts.roles)
          : null;
      const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));
      const visited = new Set<string>();
      const traversedGroupIds: string[] = [];
      let currentGroupId: string | undefined = opts.groupId;
      let depth = 0;
      let cycleDetected = false;
      let maxDepthReached = false;
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
        traversedGroupIds.push(currentGroupId);
        const membership = await member.getByUserAndGroup(ctx, {
          userId: opts.userId,
          groupId: currentGroupId,
        });
        if (
          membership !== null &&
          (roleFilter === null || roleFilter.has(membership.role))
        ) {
          return {
            requestedGroupId: opts.groupId,
            matchedGroupId: currentGroupId,
            membership,
            depth,
            isDirect: depth === 0,
            isInherited: depth > 0,
            traversedGroupIds,
            cycleDetected: false,
            maxDepthReached: false,
          };
        }
        const doc = await group.get(ctx, currentGroupId);
        if (doc === null || doc.parentGroupId === undefined) break;
        currentGroupId = doc.parentGroupId;
        depth += 1;
      }
      return {
        requestedGroupId: opts.groupId,
        matchedGroupId: null,
        membership: null,
        depth: null,
        isDirect: false,
        isInherited: false,
        traversedGroupIds,
        cycleDetected,
        maxDepthReached,
      };
    },
    require: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: string;
        groupId: string;
        roles?: string[];
        maxDepth?: number;
      },
    ) => {
      const result = await member.inherit(ctx, opts);
      if (result.membership === null) {
        throw new AuthError(
          "FORBIDDEN",
          `User ${opts.userId} has no membership on group ${opts.groupId} or its ancestors.`,
        ).toConvexError();
      }
      return {
        membership: result.membership,
        matchedGroupId: result.matchedGroupId,
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
        role?: string;
        expiresTime?: number;
        extend?: Record<string, unknown>;
      },
    ): Promise<{ inviteId: string; token: string }> => {
      const token = generateRandomString(
        inviteTokenLength,
        inviteTokenAlphabet,
      );
      const tokenHash = await sha256(token);
      const inviteId = (await ctx.runMutation(
        config.component.public.inviteCreate,
        { ...data, tokenHash, status: "pending" },
      )) as string;
      return { inviteId, token };
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
        return await ctx.runMutation(
          config.component.public.inviteAcceptByToken,
          { tokenHash, acceptedByUserId: args.acceptedByUserId },
        );
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
          role?: string;
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
    },
    revoke: async (ctx: ComponentCtx, inviteId: string) => {
      await ctx.runMutation(config.component.public.inviteRevoke, { inviteId });
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
    ): Promise<{ keyId: string; raw: string }> => {
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
      return { keyId, raw };
    },
    verify: async (
      ctx: ComponentCtx,
      rawKey: string,
    ): Promise<{ userId: string; keyId: string; scopes: ScopeChecker }> => {
      const hashedKey = await hashApiKey(rawKey);
      const doc = (await ctx.runQuery(
        config.component.public.keyGetByHashedKey,
        { hashedKey },
      )) as KeyDoc | null;
      return Fx.run(
        Fx.gen(function* () {
          yield* Fx.guard(!doc, Fx.fail(new AuthError("INVALID_API_KEY")));
          const k = doc!;
          yield* Fx.guard(k.revoked, Fx.fail(new AuthError("API_KEY_REVOKED")));
          yield* Fx.guard(
            !!(k.expiresAt && k.expiresAt < Date.now()),
            Fx.fail(new AuthError("API_KEY_EXPIRED")),
          );
          const patchData: Record<string, unknown> = { lastUsedAt: Date.now() };
          if (k.rateLimit) {
            const { limited, newState } = checkKeyRateLimit(
              k.rateLimit,
              k.rateLimitState ?? undefined,
            );
            yield* Fx.guard(
              limited,
              Fx.fail(new AuthError("API_KEY_RATE_LIMITED")),
            );
            patchData.rateLimitState = newState;
          }
          yield* Fx.promise(() =>
            ctx.runMutation(config.component.public.keyPatch, {
              keyId: k._id,
              data: patchData,
            }),
          );
          return {
            userId: k.userId,
            keyId: k._id,
            scopes: buildScopeChecker(k.scopes),
          };
        }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
      );
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
    },
    revoke: async (ctx: ComponentCtx, keyId: string) => {
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId,
        data: { revoked: true },
      });
    },
    remove: async (ctx: ComponentCtx, keyId: string) => {
      await ctx.runMutation(config.component.public.keyDelete, { keyId });
    },
    rotate: async (
      ctx: ComponentCtx,
      keyId: string,
      opts?: { name?: string; expiresAt?: number },
    ): Promise<{ keyId: string; raw: string }> => {
      const existing = await ctx.runQuery(config.component.public.keyGetById, {
        keyId,
      });
      if (!existing)
        throw new AuthError(
          "INVALID_PARAMETERS",
          "API key not found.",
        ).toConvexError();
      if ((existing as any).revoked === true) {
        throw new AuthError(
          "API_KEY_REVOKED",
          "Cannot rotate a key that is already revoked.",
        ).toConvexError();
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

  return { user, session, account, provider, group, member, invite, key };
}
