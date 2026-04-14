import { Auth, GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, GenericId } from "convex/values";

import { configDefaults, materializeProvider } from "./config";
import { getSessionUserId } from "./context";
import {
  buildScopeChecker,
  checkKeyRateLimit,
  generateApiKey,
  hashApiKey,
} from "./keys";
import type { AuthProfile, SignInParams } from "./payloads";
import { generateRandomString, sha256 } from "./random";
import { signInImpl } from "./signin";
import { TOKEN_SUB_CLAIM_DIVIDER } from "./tokens";
import type {
  AuthProviderConfig,
  KeyDoc,
  KeyScope,
  ScopeChecker,
  UserOrderBy,
  UserWhere,
} from "./types";

type ComponentCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;
type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type ComponentAuthReadCtx = ComponentReadCtx & { auth: Auth };
type UntypedRunQuery = <TArgs extends Record<string, unknown>, TResult>(
  ref: unknown,
  args: TArgs,
) => Promise<TResult>;
type AccountCredentials = { id: string; secret?: string };
type CreateAccountArgs = {
  provider: string;
  account: AccountCredentials;
  profile: AuthProfile;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};
type RetrieveAccountArgs = { provider: string; account: AccountCredentials };
type UpdateAccountCredentialsArgs = {
  provider: string;
  account: { id: string; secret: string };
};

type CredentialsAccountResult = {
  account: { _id: string; userId: string; secret?: string | null };
  user: Record<string, unknown>;
};

type UserDocLike = Record<string, unknown> | null;
type GroupDocLike = Record<string, unknown> | null;
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
type KeyDocLike = {
  revoked?: boolean;
  userId: string;
  name?: string;
  scopes?: string[];
  rateLimit?: KeyDoc["rateLimit"];
  metadata?: KeyDoc["metadata"];
};

type CoreDeps = {
  config: ReturnType<typeof configDefaults>;
  callInvalidateSessions: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: { userId: GenericId<"User">; except?: GenericId<"Session">[] },
  ) => Promise<void>;
  callCreateAccountFromCredentials: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: CreateAccountArgs,
  ) => Promise<CredentialsAccountResult>;
  callRetrieveAccountWithCredentials: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: RetrieveAccountArgs,
  ) => Promise<
    | CredentialsAccountResult
    | "InvalidAccountId"
    | "InvalidSecret"
    | "TooManyFailedAttempts"
  >;
  callModifyAccount: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    args: UpdateAccountCredentialsArgs,
  ) => Promise<void>;
  getEnrichCtx: () => <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => GenericActionCtx<DataModel>;
  inviteTokenAlphabet: string;
  inviteTokenLength: number;
};

/**
 * Build the core auth domains that back the canonical app API surface.
 *
 * Creates the grouped `user`, `session`, `account`, `provider`, `group`,
 * `member`, `invite`, and `key` APIs used by the higher-level auth
 * factory. Each namespace wraps the underlying Convex component functions with
 * application-friendly helpers, result shaping, and documentation-friendly
 * method names.
 *
 * @param deps - Internal component wiring, provider config, and helper
 *   functions needed to construct the domain API surface.
 * @returns The core domain namespaces consumed by the auth factory.
 */
export function createCoreDomains(deps: CoreDeps) {
  const {
    config,
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

  const normalizeRoleIds = (roleIds?: string[]): string[] => {
    const normalized = Array.from(new Set(roleIds ?? []));
    const invalid = normalized.filter((id) => getRoleDefinition(id) === null);
    if (invalid.length > 0) {
      throw new ConvexError({
        code: "INVALID_ROLE_IDS",
        message: "One or more role IDs are invalid.",
        invalidRoleIds: invalid,
      });
    }
    return normalized;
  };

  const listAllKeysByUser = async (ctx: ComponentCtx, userId: string) => {
    const items: Array<{ _id: string }> = [];
    let cursor: string | null = null;
    do {
      const page = (await ctx.runQuery(config.component.public.keyList, {
        where: { userId },
        limit: 100,
        cursor,
      })) as {
        items: Array<{ _id: string }>;
        nextCursor: string | null;
      };
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
  };

  const listAllMembersByUser = async (ctx: ComponentCtx, userId: string) => {
    const items: Array<{ _id: string }> = [];
    let cursor: string | null = null;
    do {
      const page = (await ctx.runQuery(config.component.public.memberList, {
        where: { userId },
        limit: 100,
        cursor,
      })) as {
        items: Array<{ _id: string }>;
        nextCursor: string | null;
      };
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
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
    users: Map<string, UserDocLike>;
    groups: Map<string, GroupDocLike>;
  };
  const AUTH_CACHE = Symbol("__convexAuthCache");
  function cache(ctx: ComponentCtx | ComponentReadCtx): CtxCache {
    const cachedCtx = ctx as typeof ctx & { [AUTH_CACHE]?: CtxCache };
    if (!cachedCtx[AUTH_CACHE]) {
      cachedCtx[AUTH_CACHE] = {
        users: new Map(),
        groups: new Map(),
      } satisfies CtxCache;
    }
    return cachedCtx[AUTH_CACHE];
  }

  const user = {
    /**
     * Fetch a user document by ID.
     *
     * Results are **cached per-execution** — calling `auth.user.get(ctx, id)`
     * multiple times within the same query or mutation handler for the same
     * `userId` returns the cached result without an additional component read.
     *
     * @param ctx - Convex query or mutation context.
     * @param userId - The user's document ID.
     * @returns The user document, or `null` if not found.
     *
     * @example
     * ```ts
     * const user = await auth.user.get(ctx, userId);
     * const name = user?.name ?? user?.email ?? "Unknown";
     * ```
     */
    get: async (ctx: ComponentReadCtx, userId: string) => {
      const c = cache(ctx);
      if (c.users.has(userId)) return c.users.get(userId);
      const result = await ctx.runQuery(config.component.public.userGetById, {
        userId,
      });
      c.users.set(userId, result);
      return result;
    },
    /**
     * List users with optional filtering, pagination, and ordering.
     *
     * Supports filtering by `email`, `phone`, `name`, and `isAnonymous`.
     * Results are paginated — pass `cursor` from a previous response to
     * load the next page.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional, combined with AND).
     * @param opts.limit - Max items per page (default 50, max 100).
     * @param opts.cursor - Cursor from a previous `nextCursor` for pagination.
     * @param opts.orderBy - Sort field: `"_creationTime"` (default), `"email"`, etc.
     * @param opts.order - Sort direction: `"asc"` or `"desc"` (default `"desc"`).
     * @returns `{ items, nextCursor }` — `nextCursor` is `null` when no more pages.
     *
     * @example
     * ```ts
     * const { items, nextCursor } = await auth.user.list(ctx, {
     *   where: { email: "alice@example.com" },
     *   limit: 10,
     * });
     * ```
     */
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
    /**
     * Convenience method: resolve the current session user and fetch their
     * full document in one call. Returns `null` if unauthenticated.
     *
     * @param ctx - Convex query or mutation context with `auth` for session lookup.
     * @returns The authenticated user's document, or `null` if unauthenticated.
     *
     * @example
     * ```ts
     * const viewer = await auth.user.viewer(ctx);
     * if (!viewer) throw new Error("Not signed in");
     * console.log(viewer.name, viewer.email);
     * ```
     */
    viewer: async (ctx: ComponentAuthReadCtx) => {
      const userId = await getSessionUserId(ctx);
      if (userId === null) return null;
      return await user.get(ctx, userId);
    },
    /**
     * Patch a user document. Accepts any fields defined on the User schema
     * (e.g. `name`, `image`, `email`, `extend`).
     *
     * @param ctx - Convex mutation context.
     * @param userId - The user's document ID.
     * @param data - Fields to merge into the user document.
     * @returns `{ userId }`.
     *
     * @example
     * ```ts
     * await auth.user.update(ctx, userId, {
     *   name: "Alice Smith",
     *   image: "https://example.com/avatar.png",
     * });
     * ```
     */
    update: async (
      ctx: ComponentCtx,
      userId: string,
      data: Record<string, unknown>,
    ) => {
      await ctx.runMutation(config.component.public.userPatch, {
        userId,
        data,
      });
      return { userId };
    },
    /**
     * Set the user's active group. Stored in `user.extend.lastActiveGroup`.
     * Pass `groupId: null` to clear. Useful for multi-workspace apps
     * where the UI needs to remember which workspace is selected.
     *
     * @param ctx - Convex mutation context.
     * @param opts.userId - The user's document ID.
     * @param opts.groupId - Group ID to set as active, or `null` to clear.
     * @returns `{ userId, groupId }` confirming the active group was set (or cleared).
     *
     * @example
     * ```ts
     * // Switch to a workspace
     * await auth.user.setActiveGroup(ctx, { userId, groupId: workspaceId });
     *
     * // Clear the active workspace
     * await auth.user.setActiveGroup(ctx, { userId, groupId: null });
     * ```
     */
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
        return { userId: opts.userId, groupId: null };
      }
      await user.update(ctx, opts.userId, {
        extend: { ...existingExtend, lastActiveGroup: opts.groupId },
      });
      return { userId: opts.userId, groupId: opts.groupId };
    },
    /**
     * Read the user's active group ID from `user.extend.lastActiveGroup`.
     * Returns `null` if no active group is set.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.userId - The user's document ID.
     * @returns The active group's document ID, or `null` if none is set.
     *
     * @example
     * ```ts
     * const activeGroupId = await auth.user.getActiveGroup(ctx, { userId });
     * if (activeGroupId) {
     *   const group = await auth.group.get(ctx, activeGroupId);
     * }
     * ```
     */
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
    /**
     * Delete a user and all associated data.
     *
     * By default (`cascade: true`) deletes the user's sessions, accounts,
     * API keys, group memberships, passkey credentials, and TOTP factors.
     * Pass `{ cascade: false }` to delete only the user document itself.
     *
     * @param ctx - Convex mutation context.
     * @param userId - The user's document ID.
     * @param opts.cascade - Whether to delete related records (default `true`).
     * @returns `{ userId }`.
     * @throws `INVALID_PARAMETERS` if `cascade` is `false` but the user has linked data.
     */
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
          listAllKeysByUser(ctx, userId),
          listAllMembersByUser(ctx, userId),
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
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "The provided parameters are invalid.",
        });
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
      return { userId };
    },
  };

  const session = {
    /**
     * Resolve the current session's ID from the JWT.
     *
     * Extracts the `sessionId` portion of the `subject` claim in the
     * identity token returned by `ctx.auth.getUserIdentity()`. The subject
     * is encoded as `userId<divider>sessionId`, so this splits on the
     * divider and returns the second segment.
     *
     * Returns `null` when there is no authenticated identity (i.e. no
     * valid session JWT).
     *
     * @param ctx - Convex query, mutation, or action context (must include `auth`).
     * @returns The current session's document ID, or `null` if unauthenticated.
     *
     * @example
     * ```ts
     * const sessionId = await auth.session.current(ctx);
     * if (!sessionId) throw new Error("Not signed in");
     * ```
     */
    current: async (ctx: { auth: Auth }) => {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) return null;
      const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
      return sessionId as GenericId<"Session">;
    },
    /**
     * Invalidate (sign out) all sessions for a given user.
     *
     * Marks every session belonging to `userId` as invalid so that
     * subsequent requests using those session JWTs will fail authentication.
     * Optionally, one or more sessions can be excluded — this is useful
     * when you want to sign out all *other* devices while keeping the
     * current session alive.
     *
     * This method delegates to the component's internal session
     * invalidation RPC.
     *
     * @param ctx - Convex action context.
     * @param args.userId - The user whose sessions should be invalidated.
     * @param args.except - Optional array of session IDs to keep valid.
     * @returns `{ userId, except }` confirming the operation.
     *
     * @example Sign out everywhere except the current session
     * ```ts
     * const sessionId = await auth.session.current(ctx);
     * await auth.session.invalidate(ctx, {
     *   userId,
     *   except: sessionId ? [sessionId] : [],
     * });
     * ```
     */
    invalidate: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: { userId: GenericId<"User">; except?: GenericId<"Session">[] },
    ) => {
      await callInvalidateSessions(ctx, args);
      return {
        userId: args.userId,
        except: args.except ?? [],
      };
    },
    /**
     * Fetch a session document by ID.
     *
     * Returns the full session document from the component database, or
     * `null` if no session with the given ID exists. Useful for inspecting
     * session metadata such as creation time or associated device info.
     *
     * @param ctx - Convex query or mutation context.
     * @param sessionId - The session's document ID.
     * @returns The session document, or `null` if not found.
     *
     * @example
     * ```ts
     * const session = await auth.session.get(ctx, sessionId);
     * if (!session) throw new Error("Session not found");
     * ```
     */
    get: async (ctx: ComponentReadCtx, sessionId: string) => {
      return await ctx.runQuery(config.component.public.sessionGetById, {
        sessionId,
      });
    },
    /**
     * List all sessions belonging to a user.
     *
     * Returns every session document associated with the given `userId`,
     * including both active and expired sessions. This is useful for
     * building "active sessions" UIs or auditing sign-in history.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.userId - The user whose sessions to list.
     * @returns An array of session documents.
     *
     * @example
     * ```ts
     * const sessions = await auth.session.list(ctx, { userId });
     * console.log(`User has ${sessions.length} sessions`);
     * ```
     */
    list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(config.component.public.sessionListByUser, {
        userId: opts.userId,
      });
    },
  };

  const account = {
    /**
     * Create a new auth account linked to a user.
     *
     * Creates a credentials-based account record for a given provider. If
     * the user does not yet exist, one is created from the supplied
     * `profile`. If `shouldLinkViaEmail` or `shouldLinkViaPhone` is set,
     * the account may be linked to an existing user whose email or phone
     * matches the profile.
     *
     * The `account.secret` (e.g. a hashed password) is optional and
     * depends on the provider type.
     *
     * @param ctx - Convex action context.
     * @param args.provider - The provider ID (e.g. `"password"`, `"credentials"`).
     * @param args.account.id - Provider-specific account identifier (e.g. email address).
     * @param args.account.secret - Optional credential secret (e.g. hashed password).
     * @param args.profile - Profile data used to create or update the user document.
     * @param args.shouldLinkViaEmail - If `true`, link to an existing user by email match.
     * @param args.shouldLinkViaPhone - If `true`, link to an existing user by phone match.
     * @returns The created account and user information.
     *
     * @example
     * ```ts
     * const result = await auth.account.create(ctx, {
     *   provider: "password",
     *   account: { id: "alice@example.com", secret: hashedPassword },
     *   profile: { email: "alice@example.com", name: "Alice" },
     * });
     * ```
     */
    create: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: CreateAccountArgs,
    ) => {
      const created = await callCreateAccountFromCredentials(ctx, args);
      return { ...created };
    },
    /**
     * Retrieve an auth account by provider and credentials.
     *
     * Looks up an account matching the given provider and account ID,
     * optionally verifying the secret (e.g. password). If the account
     * exists and the credentials are valid, the full account document is
     * returned. Returns `null` if no matching account is found or if the
     * credential verification fails (indicated by a string error from the
     * underlying RPC).
     *
     * @param ctx - Convex action context.
     * @param args.provider - The provider ID (e.g. `"password"`).
     * @param args.account.id - Provider-specific account identifier.
     * @param args.account.secret - Optional credential secret to verify.
     * @returns The account document, or `null` if not found or verification failed.
     *
     * @example
     * ```ts
     * const acct = await auth.account.get(ctx, {
     *   provider: "password",
     *   account: { id: "alice@example.com", secret: plainTextPassword },
     * });
     * if (!acct) throw new Error("Invalid credentials");
     * ```
     */
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
    /**
     * Update the credentials (secret) for an existing auth account.
     *
     * Replaces the stored secret for the account identified by `provider`
     * and `account.id`. This is the standard path for password changes
     * and password resets — the new secret is typically a freshly hashed
     * password.
     *
     * @param ctx - Convex action context.
     * @param args.provider - The provider ID (e.g. `"password"`).
     * @param args.account.id - Provider-specific account identifier.
     * @param args.account.secret - The new credential secret to store.
     * @returns `{ accountId }` confirming the update.
     *
     * @example Password reset
     * ```ts
     * await auth.account.update(ctx, {
     *   provider: "password",
     *   account: { id: "alice@example.com", secret: newHashedPassword },
     * });
     * ```
     */
    update: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      args: UpdateAccountCredentialsArgs,
    ) => {
      await callModifyAccount(ctx, args);
      return { accountId: args.account.id };
    },
    /**
     * Delete an auth account by ID.
     *
     * Removes the account record from the database. As a safety measure,
     * deletion is **refused** if this is the user's only remaining account
     * — the user must always have at least one linked account. If the
     * account is not found, returns an error result instead of throwing.
     *
     * @param ctx - Convex mutation context.
     * @param accountId - The account's document ID.
     * @returns `{ accountId }` on success.
     * @throws `ACCOUNT_NOT_FOUND` if the account does not exist.
     * @throws `INVALID_PARAMETERS` if it is the user's last account.
     *
     * @example
     * ```ts
     * await auth.account.delete(ctx, accountId);
     * ```
     */
    delete: async (ctx: ComponentCtx, accountId: string) => {
      const doc = await ctx.runQuery(config.component.public.accountGetById, {
        accountId,
      });
      if (doc === null) {
        throw new ConvexError({
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found.",
        });
      }
      const allAccounts = (await ctx.runQuery(
        config.component.public.accountListByUser,
        { userId: doc.userId },
      )) as Array<{ _id: string }>;
      if (allAccounts.length <= 1) {
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "The provided parameters are invalid.",
        });
      }
      await ctx.runMutation(config.component.public.accountDelete, {
        accountId,
      });
      return { accountId };
    },
    /**
     * List all passkey credentials registered for a user.
     *
     * Returns every WebAuthn passkey credential associated with the given
     * `userId`. Each document includes the credential's public key,
     * metadata (such as a human-readable name), and counters used for
     * replay protection.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.userId - The user whose passkeys to list.
     * @returns An array of passkey credential documents.
     *
     * @example
     * ```ts
     * const passkeys = await auth.account.listPasskeys(ctx, { userId });
     * for (const pk of passkeys) {
     *   console.log(pk.name ?? "Unnamed passkey", pk._id);
     * }
     * ```
     */
    listPasskeys: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(
        config.component.public.passkeyListByUserId,
        opts,
      );
    },
    /**
     * Rename a passkey credential.
     *
     * Updates the human-readable `name` metadata on a passkey document.
     * Useful for letting users label their passkeys (e.g. "MacBook Pro",
     * "YubiKey 5").
     *
     * @param ctx - Convex mutation context.
     * @param passkeyId - The passkey credential's document ID.
     * @param name - The new display name for the passkey.
     * @returns `{ passkeyId }` confirming the rename.
     *
     * @example
     * ```ts
     * await auth.account.renamePasskey(ctx, passkeyId, "Work laptop");
     * ```
     */
    renamePasskey: async (
      ctx: ComponentCtx,
      passkeyId: string,
      name: string,
    ) => {
      await ctx.runMutation(config.component.public.passkeyUpdateMeta, {
        passkeyId,
        data: { name },
      });
      return { passkeyId };
    },
    /**
     * Delete a passkey credential.
     *
     * Permanently removes a WebAuthn passkey credential from the database.
     * After deletion, the physical authenticator associated with this
     * credential can no longer be used to sign in.
     *
     * @param ctx - Convex mutation context.
     * @param passkeyId - The passkey credential's document ID.
     * @returns `{ passkeyId }` confirming the deletion.
     *
     * @example
     * ```ts
     * await auth.account.deletePasskey(ctx, passkeyId);
     * ```
     */
    deletePasskey: async (ctx: ComponentCtx, passkeyId: string) => {
      await ctx.runMutation(config.component.public.passkeyDelete, {
        passkeyId,
      });
      return { passkeyId };
    },
    /**
     * List all TOTP (time-based one-time password) factors for a user.
     *
     * Returns every TOTP authenticator factor registered for the given
     * `userId`. Each document includes the secret, issuer, and verification
     * metadata needed for two-factor authentication management UIs.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.userId - The user whose TOTP factors to list.
     * @returns An array of TOTP factor documents.
     *
     * @example
     * ```ts
     * const totps = await auth.account.listTotps(ctx, { userId });
     * const has2FA = totps.length > 0;
     * ```
     */
    listTotps: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
      return await ctx.runQuery(config.component.public.totpListByUserId, opts);
    },
    /**
     * Delete a TOTP factor.
     *
     * Permanently removes a TOTP authenticator factor from the database.
     * After deletion, codes generated by the corresponding authenticator
     * app will no longer be accepted for two-factor authentication.
     *
     * @param ctx - Convex mutation context.
     * @param totpId - The TOTP factor's document ID.
     * @returns `{ totpId }` confirming the deletion.
     *
     * @example
     * ```ts
     * await auth.account.deleteTotp(ctx, totpId);
     * ```
     */
    deleteTotp: async (ctx: ComponentCtx, totpId: string) => {
      await ctx.runMutation(config.component.public.totpDelete, { totpId });
      return { totpId };
    },
  };

  const provider = {
    /**
     * Sign in through a specific provider from server-side code.
     *
     * Materializes the supplied provider config, runs the standard sign-in
     * flow, and returns the resulting `userId` and `sessionId` when the
     * provider completes authentication immediately. Returns `null` for
     * providers that require additional client-side steps (for example
     * redirects, email verification, or other non-immediate flows).
     *
     * This helper is useful for trusted server flows where you already know
     * which provider should handle the sign-in and want the same behavior as
     * the public auth API without generating tokens for the client.
     *
     * @param ctx - Convex action context.
     * @param providerConfig - Provider configuration object to materialize and use.
     * @param args.accountId - Optional account document ID to sign in with directly.
     * @param args.params - Optional provider-specific parameters forwarded to the sign-in flow.
     * @returns `{ userId, sessionId }` when sign-in succeeds immediately, or `null`
     *   when the provider does not produce an immediate signed-in result.
     *
     * @example
     * ```ts
     * const signedIn = await auth.provider.signIn(ctx, passwordProvider, {
     *   params: { email: "alice@example.com", password: "secret" },
     * });
     *
     * if (!signedIn) {
     *   throw new Error("Provider requires another auth step");
     * }
     * ```
     */
    signIn: async <DataModel extends GenericDataModel>(
      ctx: GenericActionCtx<DataModel>,
      providerConfig: AuthProviderConfig,
      args: {
        accountId?: GenericId<"Account">;
        params?: SignInParams;
      },
    ) => {
      const result = await signInImpl(
        getEnrichCtx()(ctx) as Parameters<typeof signInImpl>[0],
        materializeProvider(providerConfig),
        args,
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
    /**
     * Create a new group (organization, workspace, team, etc.).
     *
     * Groups are hierarchical — set `parentGroupId` to nest under an existing
     * group, or omit it to create a root-level group. Two denormalized fields
     * are maintained automatically:
     *
     * - `rootGroupId` — the root ancestor (self-referencing for root groups).
     * - `isRoot` — `true` when the group has no parent.
     *
     * @param ctx - Convex mutation context.
     * @param data.name - Display name for the group.
     * @param data.slug - URL-safe slug (optional).
     * @param data.type - App-defined type string (e.g. `"workspace"`, `"team"`).
     * @param data.parentGroupId - Nest under this group. Omit for a root group.
     * @param data.tags - Faceted classification tags (normalized at write time).
     * @param data.extend - Arbitrary app-specific metadata.
     * @returns `{ groupId }`.
     *
     * @example Root group
     * ```ts
     * const { groupId } = await auth.group.create(ctx, {
     *   name: "Acme Corp", type: "workspace",
     * });
     * ```
     *
     * @example Nested team
     * ```ts
     * const { groupId } = await auth.group.create(ctx, {
     *   name: "Engineering", parentGroupId: orgId, type: "team",
     * });
     * ```
     */
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
    ): Promise<{ groupId: string }> => {
      const groupId = (await ctx.runMutation(
        config.component.public.groupCreate,
        data,
      )) as string;
      return { groupId };
    },
    /**
     * Fetch a group document by ID.
     *
     * Results are **cached per-execution** — calling `auth.group.get(ctx, id)`
     * multiple times within the same handler for the same `groupId` returns
     * the cached result without an additional component read.
     *
     * @param ctx - Convex query or mutation context.
     * @param groupId - The group's document ID.
     * @returns The group document (including `rootGroupId`, `isRoot`), or `null`.
     */
    get: async (ctx: ComponentReadCtx, groupId: string) => {
      const c = cache(ctx);
      if (c.groups.has(groupId)) return c.groups.get(groupId);
      const result = await ctx.runQuery(config.component.public.groupGet, {
        groupId,
      });
      c.groups.set(groupId, result);
      return result;
    },
    /**
     * List groups with optional filtering, pagination, and ordering.
     *
     * Supports filtering by `slug`, `type`, `parentGroupId`, `name`,
     * `isRoot`, and tags (`tagsAll`, `tagsAny`). The `isRoot` and
     * `parentGroupId` filters use dedicated indexes for efficient queries.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional, combined with AND).
     * @param opts.where.isRoot - `true` to find root groups, `false` for nested.
     * @param opts.where.parentGroupId - List direct children of this group.
     * @param opts.limit - Max items per page (default 50, max 100).
     * @param opts.cursor - Cursor from a previous `nextCursor`.
     * @param opts.orderBy - Sort field: `"_creationTime"`, `"name"`, `"slug"`, `"type"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns `{ items, nextCursor }`.
     *
     * @example List root workspaces
     * ```ts
     * const { items } = await auth.group.list(ctx, {
     *   where: { isRoot: true },
     *   orderBy: "name", order: "asc",
     * });
     * ```
     *
     * @example List children of a group
     * ```ts
     * const { items } = await auth.group.list(ctx, {
     *   where: { parentGroupId: orgId },
     * });
     * ```
     */
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
    /**
     * Patch a group document.
     *
     * If `parentGroupId` is changed, the group's `rootGroupId` and `isRoot`
     * fields are recomputed automatically and cascaded to all descendants.
     *
     * @param ctx - Convex mutation context.
     * @param groupId - The group's document ID.
     * @param data - Fields to merge (e.g. `name`, `slug`, `tags`, `parentGroupId`).
     * @returns `{ groupId }`.
     *
     * @example
     * ```ts
     * await auth.group.update(ctx, groupId, {
     *   name: "Acme Corp (renamed)",
     *   slug: "acme-corp",
     * });
     * ```
     */
    update: async (
      ctx: ComponentCtx,
      groupId: string,
      data: Record<string, unknown>,
    ) => {
      await ctx.runMutation(config.component.public.groupUpdate, {
        groupId,
        data,
      });
      return { groupId };
    },
    /**
     * Delete a group and recursively cascade to all descendant groups,
     * their members, invites, and tags.
     *
     * @param ctx - Convex mutation context.
     * @param groupId - The group's document ID.
     * @returns `{ groupId }`.
     *
     * @example
     * ```ts
     * await auth.group.delete(ctx, groupId);
     * ```
     */
    delete: async (ctx: ComponentCtx, groupId: string) => {
      await ctx.runMutation(config.component.public.groupDelete, { groupId });
      return { groupId };
    },
    /**
     * Walk up the group hierarchy from `groupId` and return all ancestor
     * groups in order from immediate parent to root. Detects cycles and
     * respects `maxDepth` (default 32).
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.groupId - Starting group ID.
     * @param opts.maxDepth - Max levels to traverse (default 32).
     * @param opts.includeSelf - Include the starting group in the result.
     * @returns `{ ancestors, cycleDetected, maxDepthReached }`.
     *
     * @example
     * ```ts
     * const { ancestors } = await auth.group.ancestors(ctx, {
     *   groupId: teamId,
     *   includeSelf: true,
     * });
     * const rootOrg = ancestors[ancestors.length - 1];
     * ```
     */
    ancestors: async (
      ctx: ComponentReadCtx,
      opts: { groupId: string; maxDepth?: number; includeSelf?: boolean },
    ) => {
      const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));
      const visited = new Set<string>();
      const ancestors: Array<Exclude<GroupDocLike, null>> = [];
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
    /**
     * Add a user to a group with optional role IDs.
     *
     * Role IDs are validated against the roles defined in `defineRoles()` —
     * invalid IDs throw `INVALID_ROLE_IDS`.
     * Throws `DUPLICATE_MEMBERSHIP` if the user is already a member.
     *
     * @param ctx - Convex mutation context.
     * @param data.groupId - The group to add the user to.
     * @param data.userId - The user's document ID.
     * @param data.roleIds - Role IDs from `defineRoles()` (optional).
     * @param data.status - Membership status string (optional, app-defined).
     * @param data.extend - Arbitrary app-specific metadata.
     * @returns `{ memberId }`.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * const { memberId } = await auth.member.create(ctx, {
     *   groupId: orgId,
     *   userId,
     *   roleIds: [roles.orgAdmin.id],
     * });
     * ```
     */
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
      const roleIds = normalizeRoleIds(data.roleIds);
      const memberId = (await ctx.runMutation(
        config.component.public.memberAdd,
        { ...data, roleIds },
      )) as string;
      return { memberId };
    },
    /**
     * Fetch a membership document by its document ID.
     *
     * @param ctx - Convex query or mutation context.
     * @param memberId - The membership document ID.
     * @returns The membership document, or `null` if not found.
     *
     * @example
     * ```ts
     * const membership = await auth.member.get(ctx, memberId);
     * if (!membership) throw new Error("Membership not found");
     * console.log(membership.roleIds, membership.groupId);
     * ```
     */
    get: async (ctx: ComponentReadCtx, memberId: string) => {
      return await ctx.runQuery(config.component.public.memberGet, {
        memberId,
      });
    },
    /**
     * List memberships with optional filtering and pagination.
     *
     * Supports filtering by `groupId`, `userId`, `roleId`, and `status`.
     * When `groupId` and `status` are both provided, a compound index
     * is used for efficient queries.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional).
     * @param opts.limit - Max items per page (default 50, max 100).
     * @param opts.cursor - Cursor for pagination.
     * @param opts.orderBy - Sort field: `"_creationTime"` or `"status"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns `{ items, nextCursor }`.
     *
     * @example
     * ```ts
     * const { items } = await auth.member.list(ctx, {
     *   where: { groupId: orgId },
     *   limit: 20,
     *   orderBy: "_creationTime",
     *   order: "asc",
     * });
     * ```
     */
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
    /**
     * Remove a membership by its document ID.
     *
     * @param ctx - Convex mutation context.
     * @param memberId - The membership document ID.
     * @returns `{ memberId }`.
     *
     * @example
     * ```ts
     * await auth.member.delete(ctx, memberId);
     * ```
     */
    delete: async (ctx: ComponentCtx, memberId: string) => {
      await ctx.runMutation(config.component.public.memberRemove, { memberId });
      return { memberId };
    },
    /**
     * Patch a membership's `roleIds`, `status`, or `extend` fields.
     * Role IDs are validated against `defineRoles()`.
     *
     * @param ctx - Convex mutation context.
     * @param memberId - The membership document ID.
     * @param data - Fields to merge. `roleIds` are validated.
     * @returns `{ memberId }`.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * await auth.member.update(ctx, memberId, {
     *   roleIds: [roles.orgAdmin.id],
     *   status: "active",
     * });
     * ```
     */
    update: async (
      ctx: ComponentCtx,
      memberId: string,
      data: Record<string, unknown>,
    ) => {
      const nextData = { ...data };
      if ("roleIds" in nextData) {
        nextData.roleIds = normalizeRoleIds(
          Array.isArray(nextData.roleIds)
            ? (nextData.roleIds as string[])
            : undefined,
        );
      }
      await ctx.runMutation(config.component.public.memberUpdate, {
        memberId,
        data: nextData,
      });
      return { memberId };
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
     * const result = await auth.member.inspect(ctx, { userId, groupId });
     * if (!result.membership) return null;
     * ```
     *
     * @example Check grants after inspection
     * ```ts
     * const result = await auth.member.inspect(ctx, {
     *   userId, groupId,
     * });
     * const canCreate = result.grants.includes("issues.create");
     * ```
     *
     * @example Walk hierarchy + check grants
     * ```ts
     * const result = await auth.member.inspect(ctx, {
     *   userId, groupId: teamId, ancestry: true,
     * });
     * ```
     */
    inspect: async (
      ctx: ComponentReadCtx,
      opts: {
        userId: string;
        groupId: string;
        ancestry?: boolean;
        maxDepth?: number;
      },
    ) => {
      const useAncestry = opts.ancestry === true;

      let membership: MemberDocLike = null;

      if (useAncestry) {
        // Hierarchy walk — single component RPC
        const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));
        const memberResolveRef = (
          config.component.public as Record<string, unknown>
        )["memberResolve"];
        const result = (await (ctx.runQuery as UntypedRunQuery)(
          memberResolveRef,
          {
            userId: opts.userId,
            groupId: opts.groupId,
            maxDepth,
            ancestry: true,
          },
        )) as { membership: MemberDocLike };
        membership = result.membership;
      } else {
        // Fast path — direct lookup, 1 read
        const doc = await ctx.runQuery(
          config.component.public.memberGetByGroupAndUser,
          { userId: opts.userId, groupId: opts.groupId },
        );
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
      const membershipGrants = resolveGrantedPermissions(membershipRoleIds);

      return {
        membership,
        roleIds: membershipRoleIds,
        grants: membershipGrants,
      };
    },
    require: async (
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
      const roleFilter =
        validatedRoleIds.length > 0 ? new Set(validatedRoleIds) : null;
      const result = await member.inspect(ctx, {
        userId: opts.userId,
        groupId: opts.groupId,
        ancestry: opts.ancestry,
        maxDepth: opts.maxDepth,
      });
      if (result.membership === null) {
        throw new ConvexError({
          code: "NOT_A_MEMBER",
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      if (
        roleFilter !== null &&
        !result.roleIds.some((roleId: string) => roleFilter.has(roleId))
      ) {
        throw new ConvexError({
          code: "NOT_A_MEMBER",
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      const missingGrants = requiredGrants.filter(
        (grant) => !result.grants.includes(grant),
      );
      if (missingGrants.length > 0) {
        throw new ConvexError({
          code: "MISSING_GRANTS",
          message: "User is missing required grants.",
          groupId: opts.groupId,
          missingGrants,
        });
      }
      return result;
    },
  };

  const invite = {
    /**
     * Create a pending invite. Returns a one-time `token` the recipient
     * uses to accept. Optionally scoped to a group with role IDs.
     *
     * @param ctx - Convex mutation context.
     * @param data.groupId - The group to invite the user to (optional).
     * @param data.invitedByUserId - The user who created this invite (optional).
     * @param data.email - The invitee's email address (optional).
     * @param data.roleIds - Role IDs from `defineRoles()` to assign on acceptance (optional).
     * @param data.expiresTime - Expiration timestamp in ms since epoch (optional).
     * @param data.extend - Arbitrary app-specific metadata (optional).
     * @returns `{ inviteId, token }`.
     * @throws `INVALID_ROLE_IDS` if any supplied role IDs are not defined.
     *
     * @example
     * ```ts
     * const { token } = await auth.invite.create(ctx, {
     *   groupId, email: "alice@example.com", roleIds: [roles.member.id],
     * });
     * ```
     */
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
      const roleIds = normalizeRoleIds(data.roleIds);
      const token = generateRandomString(
        inviteTokenLength,
        inviteTokenAlphabet,
      );
      const tokenHash = await sha256(token);
      const inviteId = (await ctx.runMutation(
        config.component.public.inviteCreate,
        { ...data, roleIds, tokenHash, status: "pending" },
      )) as string;
      return { inviteId, token };
    },
    /**
     * Fetch an invite document by ID.
     *
     * Returns the full invite document including its status, email,
     * group, role IDs, and token hash. Useful for displaying invite
     * details or checking status before performing actions.
     *
     * @param ctx - Convex query or mutation context.
     * @param inviteId - The invite's document ID.
     * @returns The invite document, or `null` if not found.
     *
     * @example
     * ```ts
     * const invite = await auth.invite.get(ctx, inviteId);
     * if (invite?.status === "pending") {
     *   // show invite details
     * }
     * ```
     */
    get: async (ctx: ComponentReadCtx, inviteId: string) => {
      return await ctx.runQuery(config.component.public.inviteGet, {
        inviteId,
      });
    },
    token: {
      /**
       * Look up an invite by its raw token string.
       *
       * Hashes the raw token and queries the database for a matching
       * invite. This is the standard path for invite-link landing pages
       * where the token is extracted from the URL.
       *
       * @param ctx - Convex query or mutation context.
       * @param token - The raw invite token string from the invite link.
       * @returns The invite document, or `null` if no matching invite exists.
       *
       * @example
       * ```ts
       * const invite = await auth.invite.token.get(ctx, tokenFromUrl);
       * if (!invite || invite.status !== "pending") {
       *   throw new Error("Invalid or expired invite");
       * }
       * ```
       */
      get: async (ctx: ComponentReadCtx, token: string) => {
        const tokenHash = await sha256(token);
        return await ctx.runQuery(
          config.component.public.inviteGetByTokenHash,
          { tokenHash },
        );
      },
      /**
       * Accept an invite by token. Creates a membership and marks the invite as accepted.
       *
       * Hashes the raw token, finds the matching invite, creates a group
       * membership with the invite's role IDs, and transitions the invite
       * status to `"accepted"`.
       *
       * @param ctx - Convex mutation context.
       * @param args.token - The raw invite token string.
       * @param args.acceptedByUserId - The user accepting the invite.
       * @returns The created membership details.
       *
       * @example
       * ```ts
       * const result = await auth.invite.token.accept(ctx, {
       *   token: tokenFromUrl,
       *   acceptedByUserId: userId,
       * });
       * ```
       */
      accept: async (
        ctx: ComponentCtx,
        args: { token: string; acceptedByUserId: string },
      ) => {
        const tokenHash = await sha256(args.token);
        const result = await ctx.runMutation(
          config.component.public.inviteAcceptByToken,
          { tokenHash, acceptedByUserId: args.acceptedByUserId },
        );
        return { ...result };
      },
    },
    /**
     * List invites with optional filtering by group, status, email, etc.
     * Results are paginated.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional).
     * @param opts.where.status - `"pending"`, `"accepted"`, `"revoked"`, or `"expired"`.
     * @param opts.limit - Max items per page (default 50, max 100).
     * @param opts.cursor - Cursor from a previous `nextCursor` for pagination.
     * @param opts.orderBy - Sort field: `"_creationTime"`, `"status"`, `"email"`,
     *   `"expiresTime"`, or `"acceptedTime"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns `{ items, nextCursor }` — `nextCursor` is `null` when there are no more pages.
     *
     * @example
     * ```ts
     * const { items } = await auth.invite.list(ctx, {
     *   where: { groupId, status: "pending" },
     *   orderBy: "_creationTime",
     *   order: "desc",
     * });
     * ```
     */
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
    /**
     * Accept an invite by ID. Optionally specify who accepted it.
     *
     * Transitions the invite's status to `"accepted"` and optionally
     * records the accepting user. Unlike `invite.token.accept`, this
     * method does not automatically create a group membership — use it
     * for admin-driven invite acceptance flows.
     *
     * @param ctx - Convex mutation context.
     * @param inviteId - The invite's document ID.
     * @param acceptedByUserId - The user who accepted the invite (optional).
     * @returns `{ inviteId, acceptedByUserId }`.
     *
     * @example
     * ```ts
     * await auth.invite.accept(ctx, inviteId, userId);
     * ```
     */
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
        inviteId,
        acceptedByUserId: acceptedByUserId ?? null,
      };
    },
    /**
     * Revoke a pending invite. Sets its status to `"revoked"`.
     *
     * Once revoked, the invite's token can no longer be used to accept
     * the invitation. This is a permanent status change.
     *
     * @param ctx - Convex mutation context.
     * @param inviteId - The invite's document ID.
     * @returns `{ inviteId }`.
     *
     * @example
     * ```ts
     * await auth.invite.revoke(ctx, inviteId);
     * ```
     */
    revoke: async (ctx: ComponentCtx, inviteId: string) => {
      await ctx.runMutation(config.component.public.inviteRevoke, { inviteId });
      return { inviteId };
    },
  };

  const key = {
    /**
     * Create an API key for programmatic access. The returned `secret`
     * (prefixed `sk_`) is shown only once — it is stored as a hash.
     *
     * @param ctx - Convex mutation context.
     * @param opts.userId - Owner of the key.
     * @param opts.name - Human-readable name (e.g. `"CI Pipeline"`).
     * @param opts.scopes - Array of `{ resource, actions }` permission scopes.
     * @param opts.rateLimit - Optional per-key rate limit `{ maxRequests, windowMs }`.
     * @param opts.expiresAt - Optional expiration timestamp (ms since epoch).
     * @param opts.metadata - Arbitrary app-specific metadata.
     * @returns `{ keyId, secret }`. Store `secret` securely — it cannot be retrieved later.
     *
     * @example
     * ```ts
     * const { secret } = await auth.key.create(ctx, {
     *   userId,
     *   name: "CI Pipeline",
     *   scopes: [{ resource: "data", actions: ["read"] }],
     * });
     * ```
     */
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
    ): Promise<{ keyId: string; secret: string }> => {
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
      return { keyId, secret: raw };
    },
    /**
     * Verify an API key and return the owner's identity and scopes.
     *
     * Checks the key against the database, enforces expiration and rate
     * limits, and returns a `ScopeChecker` for permission evaluation.
     *
     * @param ctx - Convex mutation context (updates `lastUsedAt` and rate limit state).
     * @param rawKey - The raw `sk_*` key string.
     * @returns `{ userId, keyId, scopes }` where `scopes.can(resource, action)` checks permissions.
     * @throws `INVALID_API_KEY` if the key is not found.
     * @throws `API_KEY_REVOKED` if the key was revoked.
     * @throws `API_KEY_EXPIRED` if the key is past its `expiresAt`.
     * @throws `API_KEY_RATE_LIMITED` if the rate limit is exceeded.
     *
     * @example
     * ```ts
     * const { userId, scopes } = await auth.key.verify(ctx, rawKey);
     * const canRead = scopes.can("data", "read");
     * ```
     */
    verify: async (
      ctx: ComponentCtx,
      rawKey: string,
    ): Promise<{ userId: string; keyId: string; scopes: ScopeChecker }> => {
      const hashedKey = await hashApiKey(rawKey);
      const doc = (await ctx.runQuery(
        config.component.public.keyGetByHashedKey,
        { hashedKey },
      )) as KeyDoc | null;
      if (!doc) {
        throw new ConvexError({
          code: "INVALID_API_KEY",
          message: "Invalid API key.",
        });
      }
      const k = doc;
      if (k.revoked) {
        throw new ConvexError({
          code: "API_KEY_REVOKED",
          message: "This API key has been revoked.",
        });
      }
      if (k.expiresAt && k.expiresAt < Date.now()) {
        throw new ConvexError({
          code: "API_KEY_EXPIRED",
          message: "This API key has expired.",
        });
      }
      const patchData: Record<string, unknown> = { lastUsedAt: Date.now() };
      if (k.rateLimit) {
        const { limited, newState } = checkKeyRateLimit(
          k.rateLimit,
          k.rateLimitState ?? undefined,
        );
        if (limited) {
          throw new ConvexError({
            code: "API_KEY_RATE_LIMITED",
            message: "API key rate limit exceeded. Please try again later.",
          });
        }
        patchData.rateLimitState = newState;
      }
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId: k._id,
        data: patchData,
      });
      return {
        userId: k.userId,
        keyId: k._id,
        scopes: buildScopeChecker(k.scopes),
      };
    },
    /**
     * List API keys with optional filtering by user, revocation status, name,
     * or prefix. Results are paginated. Does not expose raw key secrets.
     *
     * @param ctx - Convex query or mutation context.
     * @param opts.where - Filter criteria (all optional, combined with AND).
     * @param opts.limit - Max items per page (default 50, max 100).
     * @param opts.cursor - Cursor from a previous `nextCursor` for pagination.
     * @param opts.orderBy - Sort field: `"_creationTime"`, `"name"`, `"lastUsedAt"`, `"expiresAt"`, or `"revoked"`.
     * @param opts.order - Sort direction: `"asc"` or `"desc"`.
     * @returns `{ items, nextCursor }` — `nextCursor` is `null` when no more pages.
     *
     * @example
     * ```ts
     * const { items } = await auth.key.list(ctx, {
     *   where: { userId, revoked: false },
     *   orderBy: "lastUsedAt",
     *   order: "desc",
     * });
     * ```
     */
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
    /**
     * Fetch an API key record by ID. Does not expose the raw key secret.
     *
     * Returns the key document including metadata, scopes, rate limit
     * configuration, and revocation status. The raw secret is never
     * stored or returned — only the hashed key and display prefix.
     *
     * @param ctx - Convex query or mutation context.
     * @param keyId - The API key's document ID.
     * @returns The key document, or `null` if not found.
     *
     * @example
     * ```ts
     * const key = await auth.key.get(ctx, keyId);
     * if (!key) throw new Error("Key not found");
     * console.log(key.name, key.prefix);
     * ```
     */
    get: async (
      ctx: ComponentReadCtx,
      keyId: string,
    ): Promise<KeyDoc | null> => {
      const doc = (await ctx.runQuery(config.component.public.keyGetById, {
        keyId,
      })) as KeyDoc | null;
      return doc ?? null;
    },
    /**
     * Update a key's name, scopes, or rate limit.
     *
     * Patches the specified fields on the API key document. Only the
     * provided fields are changed — omitted fields remain unchanged.
     *
     * @param ctx - Convex mutation context.
     * @param keyId - The API key's document ID.
     * @param data - Fields to merge into the key document.
     * @returns `{ keyId }`.
     *
     * @example
     * ```ts
     * await auth.key.update(ctx, keyId, {
     *   name: "CI Pipeline (updated)",
     *   scopes: [{ resource: "data", actions: ["read", "write"] }],
     * });
     * ```
     */
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
      return { keyId };
    },
    /**
     * Soft-delete: set `revoked: true`. The key can no longer be verified.
     *
     * After revocation, any subsequent calls to `auth.key.verify` with
     * this key will throw `API_KEY_REVOKED`.
     * The key record is preserved for audit purposes.
     *
     * @param ctx - Convex mutation context.
     * @param keyId - The API key's document ID.
     * @returns `{ keyId }`.
     *
     * @example
     * ```ts
     * await auth.key.revoke(ctx, keyId);
     * ```
     */
    revoke: async (ctx: ComponentCtx, keyId: string) => {
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId,
        data: { revoked: true },
      });
      return { keyId };
    },
    /**
     * Hard-delete: permanently remove the key record.
     *
     * Unlike `revoke`, this permanently removes the key document from
     * the database. Use this when you need to fully clean up a key
     * rather than preserving it for audit history.
     *
     * @param ctx - Convex mutation context.
     * @param keyId - The API key's document ID.
     * @returns `{ keyId }`.
     *
     * @example
     * ```ts
     * await auth.key.delete(ctx, keyId);
     * ```
     */
    delete: async (ctx: ComponentCtx, keyId: string) => {
      await ctx.runMutation(config.component.public.keyDelete, { keyId });
      return { keyId };
    },
    /**
     * Rotate a key: revokes the old key and creates a new one with the
     * same user, scopes, and rate limit. Returns the new `keyId` and `secret`.
     * Throws if the key does not exist or is already revoked.
     *
     * @param ctx - Convex mutation context.
     * @param keyId - The existing API key's document ID to rotate.
     * @param opts.name - Optional new name for the rotated key (defaults to the old name).
     * @param opts.expiresAt - Optional new expiration timestamp in ms since epoch.
     * @returns `{ keyId, secret }` with the new key.
     * @throws `INVALID_PARAMETERS` if the key does not exist.
     * @throws `API_KEY_REVOKED` if the key is already revoked.
     *
     * @example
     * ```ts
     * const { keyId, secret } = await auth.key.rotate(ctx, oldKeyId, {
     *   expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
     * });
     * // Store secret securely — shown only once
     * ```
     */
    rotate: async (
      ctx: ComponentCtx,
      keyId: string,
      opts?: { name?: string; expiresAt?: number },
    ): Promise<{ keyId: string; secret: string }> => {
      const existing = await ctx.runQuery(config.component.public.keyGetById, {
        keyId,
      });
      if (!existing) {
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "The provided parameters are invalid.",
        });
      }
      const typedExisting = existing as KeyDocLike;
      if (typedExisting.revoked === true) {
        throw new ConvexError({
          code: "API_KEY_REVOKED",
          message: "This API key has been revoked.",
        });
      }
      await ctx.runMutation(config.component.public.keyPatch, {
        keyId,
        data: { revoked: true },
      });
      return await key.create(ctx, {
        userId: typedExisting.userId,
        name: opts?.name ?? typedExisting.name ?? keyId,
        scopes: (typedExisting.scopes ?? []) as unknown as KeyScope[],
        rateLimit: typedExisting.rateLimit,
        expiresAt: opts?.expiresAt,
        metadata: typedExisting.metadata,
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
    invite,
    key,
  };
}
