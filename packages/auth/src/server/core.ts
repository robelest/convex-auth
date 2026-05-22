import { Auth, GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, GenericId } from "convex/values";

import type { ComponentCtx, ComponentReadCtx } from "./component/context";
import { configDefaults } from "./config";
import { getSessionUserId } from "./context";
import { authDb } from "./db";
import { getAuthSessionId } from "./sessions";
import { cached, ctxCacheHas, invalidateCtxCache } from "./cache/context";
import { buildScopeChecker, checkKeyRateLimit, generateApiKey, hashApiKey } from "./keys";
import type { AuthProfile, SignInParams } from "./payloads";
import { generateRandomString, sha256 } from "./random";
import type {
  AuthProviderConfig,
  Doc,
  KeyDoc,
  KeyScope,
  ScopeChecker,
  UserOrderBy,
  UserWhere,
} from "./types";

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

type UserDocLike = Doc<"User"> | null;
type GroupDocLike = Doc<"Group"> | null;
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
/** Convex-native `PaginationResult<T>` shape returned by the `*List` component queries. */
type Paginated<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: "SplitRecommended" | "SplitRequired" | null;
};
/** Options accepted by `member.list`. */
type MemberListOpts = {
  where?: { groupId?: string; userId?: string; roleId?: string; status?: string };
  limit?: number;
  cursor?: string | null;
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
    CredentialsAccountResult | "InvalidAccountId" | "InvalidSecret" | "TooManyFailedAttempts"
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
  signInForProvider?: <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
    providerConfig: AuthProviderConfig,
    args: {
      accountId?: GenericId<"Account">;
      params?: SignInParams;
    },
  ) => Promise<{ userId: string; sessionId: string } | null>;
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

  function userGet(ctx: ComponentReadCtx, userId: string): Promise<UserDocLike>;
  function userGet(ctx: ComponentReadCtx, userIds: readonly string[]): Promise<Array<UserDocLike>>;
  async function userGet(
    ctx: ComponentReadCtx,
    input: string | readonly string[],
  ): Promise<UserDocLike | Array<UserDocLike>> {
    if (typeof input === "string") {
      return (await cached(ctx, `user:${input}`, () =>
        ctx.runQuery(config.component.user.get, {
          id: input,
        }),
      )) as UserDocLike;
    }
    const userIds = input;
    if (userIds.length === 0) return [];
    const unique = Array.from(new Set(userIds));
    const toFetch: string[] = [];
    for (const id of unique) {
      if (!ctxCacheHas(ctx, `user:${id}`)) {
        toFetch.push(id);
      }
    }
    if (toFetch.length > 0) {
      const docs = (await ctx.runQuery(config.component.user.get, {
        ids: toFetch,
      })) as Array<UserDocLike>;
      for (let i = 0; i < toFetch.length; i += 1) {
        const id = toFetch[i]!;
        const value = docs[i] ?? null;
        void cached(ctx, `user:${id}`, () => Promise.resolve(value));
      }
    }
    return (await Promise.all(
      userIds.map((id) =>
        cached(ctx, `user:${id}`, () =>
          ctx.runQuery(config.component.user.get, { id }),
        ),
      ),
    )) as Array<UserDocLike>;
  }

  const user = {
    /**
     * Fetch a user document by ID, or a batch of user documents by IDs.
     *
     * @example Single
     * ```ts
     * const user = await auth.user.get(ctx, userId);
     * ```
     *
     * @example Batched
     * ```ts
     * const users = await auth.user.get(ctx, memberIds);
     * ```
     */
    get: userGet,
    /**
     * The current session's user id, or `null` when unauthenticated.
     *
     * Pairs with {@link viewer} which fetches the full document; use `id`
     * when you only need the id (no DB read for the user row).
     *
     * @example
     * ```ts
     * const userId = await auth.user.id(ctx);
     * if (userId === null) return null;
     * ```
     */
    id: async (ctx: ComponentAuthReadCtx) => {
      return (await getSessionUserId(ctx)) as GenericId<"User"> | null;
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
      return (await ctx.runQuery(config.component.user.list, {
        where: opts.where,
        paginationOpts: {
          numItems: Math.min(Math.max(opts.limit ?? 50, 1), 100),
          cursor: opts.cursor ?? null,
        },
        orderBy: opts.orderBy,
        order: opts.order,
      })) as Paginated<Doc<"User">>;
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
     * Provider-agnostic management of the emails a user owns. Singular
     * `email` namespace (consistent with `auth.member`);
     * the collection is exposed via `.list`.
     *
     * - `list(ctx)` — every `UserEmail` the user owns (provenance incl.).
     * - `add(ctx, email)` — record an **unverified** address. Does not
     *   verify (verification stays proof-driven via sign-in flows) and
     *   does not become primary.
     * - `remove(ctx, email)` — delete an address. Throws if it is the
     *   primary, the only verified email, or a connection-managed row.
     * - `primary(ctx)` — read the current primary `UserEmail | null`.
     * - `primary(ctx, email)` — promote a **verified** address to primary
     *   (syncs the denormalized `User.email`).
     *
     * `userId` defaults to the current session user everywhere.
     */
    email: (() => {
      async function primary(
        ctx: ComponentAuthReadCtx,
        opts?: { userId?: string },
      ): Promise<Doc<"UserEmail"> | null>;
      async function primary(
        ctx: ComponentCtx & { auth: Auth },
        email: string,
        opts?: { userId?: string },
      ): Promise<{ email: string }>;
      async function primary(
        ctx: ComponentAuthReadCtx | (ComponentCtx & { auth: Auth }),
        emailOrOpts?: string | { userId?: string },
        maybeOpts?: { userId?: string },
      ): Promise<(Doc<"UserEmail"> | null) | { email: string }> {
        const setting = typeof emailOrOpts === "string";
        const opts = (setting ? maybeOpts : emailOrOpts) as
          | { userId?: string }
          | undefined;
        const userId = opts?.userId ?? (await getSessionUserId(ctx));
        if (userId === null || userId === undefined) {
          if (setting) {
            throw new ConvexError({
              code: "NOT_SIGNED_IN",
              message: "Authentication required.",
            });
          }
          return null;
        }
        if (setting) {
          await (ctx as ComponentCtx).runMutation(
            config.component.user.email.setPrimary,
            { userId, email: (emailOrOpts as string).toLowerCase() },
          );
          return { email: (emailOrOpts as string).toLowerCase() };
        }
        const rows = (await ctx.runQuery(
          config.component.user.email.list,
          { userId },
        )) as Doc<"UserEmail">[];
        return rows.find((r) => r.isPrimary) ?? null;
      }
      return {
        list: async (
          ctx: ComponentAuthReadCtx,
          opts?: { userId?: string },
        ): Promise<Doc<"UserEmail">[]> => {
          const userId = opts?.userId ?? (await getSessionUserId(ctx));
          if (userId === null || userId === undefined) return [];
          return (await ctx.runQuery(config.component.user.email.list, {
            userId,
          })) as Doc<"UserEmail">[];
        },
        add: async (
          ctx: ComponentCtx & { auth: Auth },
          email: string,
          opts?: { userId?: string },
        ): Promise<{ email: string }> => {
          const userId = opts?.userId ?? (await getSessionUserId(ctx));
          if (userId === null || userId === undefined) {
            throw new ConvexError({
              code: "NOT_SIGNED_IN",
              message: "Authentication required.",
            });
          }
          const addr = email.toLowerCase();
          await ctx.runMutation(config.component.user.email.upsert, {
            userId,
            email: addr,
            verified: false,
            isPrimary: false,
            source: "password",
          });
          return { email: addr };
        },
        remove: async (
          ctx: ComponentCtx & { auth: Auth },
          email: string,
          opts?: { userId?: string },
        ): Promise<{ email: string }> => {
          const userId = opts?.userId ?? (await getSessionUserId(ctx));
          if (userId === null || userId === undefined) {
            throw new ConvexError({
              code: "NOT_SIGNED_IN",
              message: "Authentication required.",
            });
          }
          const addr = email.toLowerCase();
          await ctx.runMutation(config.component.user.email.delete, {
            userId,
            email: addr,
          });
          return { email: addr };
        },
        primary,
      };
    })(),
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
    update: async (ctx: ComponentCtx, userId: string, data: Record<string, unknown>) => {
      await ctx.runMutation(config.component.user.update, {
        userId,
        data,
      });
      invalidateCtxCache(ctx, `user:${userId}`);
      return { userId };
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
    delete: async (ctx: ComponentCtx, userId: string, opts?: { cascade?: boolean }) => {
      await ctx.runMutation(config.component.user.delete, {
        userId,
        cascade: opts?.cascade !== false,
      });
      invalidateCtxCache(ctx);
      return { userId };
    },
  };

  const session = {
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
     * const identity = await ctx.auth.getUserIdentity();
     * const sessionId = identity?.sid;
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
    get: async (
      ctx: ComponentReadCtx,
      sessionId: string,
    ): Promise<Doc<"Session"> | null> => {
      return (await cached(ctx, `session:${sessionId}`, () =>
        ctx.runQuery(config.component.session.get, {
          sessionId,
        }),
      )) as Doc<"Session"> | null;
    },
    /**
     * The current session's id, or `null` when unauthenticated.
     *
     * Pairs with `auth.user.id(ctx)`; resolves the session id from the
     * incoming JWT without a DB read.
     *
     * @example
     * ```ts
     * const sessionId = await auth.session.id(ctx);
     * if (sessionId === null) return null;
     * ```
     */
    id: async (ctx: ComponentAuthReadCtx) => {
      return (await getAuthSessionId(ctx)) as GenericId<"Session"> | null;
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
    list: async (
      ctx: ComponentReadCtx,
      opts: { userId: string },
    ): Promise<Doc<"Session">[]> => {
      return (await ctx.runQuery(config.component.session.list, {
        userId: opts.userId,
      })) as Doc<"Session">[];
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
      await ctx.runMutation(config.component.account.delete, {
        accountId,
        requireOtherAccount: true,
      });
      return { accountId };
    },
    /**
     * Attach a new provider account to the current authenticated user.
     *
     * Idempotent: linking the same `(provider, providerAccountId)` to the
     * same user is a no-op. Linking a `(provider, providerAccountId)` that
     * already belongs to a different user throws `ACCOUNT_ALREADY_LINKED`.
     *
     * When the current user is anonymous (`isAnonymous: true`), this also
     * flips `isAnonymous: false` and merges the supplied profile fields
     * (`name`, `image`, `email`) into the user document — folding in the
     * "upgrade anonymous to permanent account" flow under one verb.
     *
     * Fires `after({ kind: "userUpdated" })` on success.
     *
     * @param ctx - Convex mutation context with `auth`.
     * @param args.provider - Provider id (e.g. `"google"`, `"github"`).
     * @param args.profile - Provider profile. Must include `id` (provider
     *   account id) or `email`/`phone`. Optional `name`, `image`, `email`
     *   are merged into the user when upgrading from anonymous.
     * @returns `{ accountId, userId, alreadyLinked }`.
     * @throws `NOT_SIGNED_IN` if no current user.
     * @throws `ACCOUNT_ALREADY_LINKED` if the provider account belongs to
     *   a different user.
     *
     * @example Link Google after the user signed in with password
     * ```ts
     * await auth.account.link(ctx, {
     *   provider: "google",
     *   profile: { id: googleSub, email, name, image },
     * });
     * ```
     */
    link: async (
      ctx: ComponentCtx & { auth: Auth },
      args: {
        provider: string;
        profile: { id?: string; email?: string; phone?: string; name?: string; image?: string };
      },
    ): Promise<{ accountId: string; userId: string; alreadyLinked: boolean }> => {
      const userId = await getSessionUserId(ctx);
      if (userId === null) {
        throw new ConvexError({
          code: "NOT_SIGNED_IN",
          message: "Must be authenticated to link an account.",
        });
      }
      const providerAccountId =
        args.profile.id ?? args.profile.email ?? args.profile.phone ?? null;
      if (providerAccountId === null) {
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message:
            "args.profile must include `id`, `email`, or `phone` for account linking.",
        });
      }
      const db = authDb(ctx, config);
      const existing = await db.accounts.get(args.provider, providerAccountId);
      if (existing !== null) {
        if ((existing as { userId: string }).userId === userId) {
          return {
            accountId: (existing as { _id: string })._id,
            userId,
            alreadyLinked: true,
          };
        }
        throw new ConvexError({
          code: "ACCOUNT_ALREADY_LINKED",
          message: "Provider account is already linked to a different user.",
          provider: args.provider,
        });
      }
      const accountId = await db.accounts.create({
        userId,
        provider: args.provider,
        providerAccountId,
      });
      const user = (await db.users.getById(userId)) as { isAnonymous?: boolean } | null;
      if (user?.isAnonymous === true) {
        const patchData: Record<string, unknown> = { isAnonymous: false };
        if (typeof args.profile.name === "string") patchData.name = args.profile.name;
        if (typeof args.profile.email === "string") patchData.email = args.profile.email;
        if (typeof args.profile.image === "string") patchData.image = args.profile.image;
        await db.users.patch(userId, patchData);
      }
      const after = config.callbacks?.after;
      if (after !== undefined) {
        await after(ctx as never, {
          kind: "userUpdated",
          userId: userId as GenericId<"User">,
          existingUserId: userId as GenericId<"User">,
          type: "credentials",
          provider: { id: args.provider, type: "credentials" } as never,
          profile: args.profile as never,
        });
      }
      return { accountId, userId, alreadyLinked: false };
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
    listPasskeys: async (
      ctx: ComponentReadCtx,
      opts: { userId: string },
    ): Promise<Doc<"Passkey">[]> => {
      return (await ctx.runQuery(
        config.component.factor.passkey.list,
        opts,
      )) as Doc<"Passkey">[];
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
    renamePasskey: async (ctx: ComponentCtx, passkeyId: string, name: string) => {
      await ctx.runMutation(config.component.factor.passkey.update, {
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
      await ctx.runMutation(config.component.factor.passkey.delete, {
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
    listTotps: async (
      ctx: ComponentReadCtx,
      opts: { userId: string },
    ): Promise<Doc<"TotpFactor">[]> => {
      return (await ctx.runQuery(
        config.component.factor.totp.list,
        opts,
      )) as Doc<"TotpFactor">[];
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
      await ctx.runMutation(config.component.factor.totp.delete, { totpId });
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
     *   when the provider does not produce an immediate session.
     *
     * @example
     * ```ts
     * const session = await auth.provider.signIn(ctx, passwordProvider, {
     *   params: { email: "alice@example.com", password: "secret" },
     * });
     *
     * if (!session) {
     *   throw new Error("Provider requires another auth step");
     * }
     * ```
     */
    signIn: deps.signInForProvider
      ? async <DataModel extends GenericDataModel>(
          ctx: GenericActionCtx<DataModel>,
          providerConfig: AuthProviderConfig,
          args: {
            accountId?: GenericId<"Account">;
            params?: SignInParams;
          },
        ) => {
          return deps.signInForProvider!(ctx, providerConfig, args);
        }
      : undefined,
  };

  function groupGet(ctx: ComponentReadCtx, groupId: string): Promise<GroupDocLike>;
  function groupGet(
    ctx: ComponentReadCtx,
    groupIds: readonly string[],
  ): Promise<Array<GroupDocLike>>;
  async function groupGet(
    ctx: ComponentReadCtx,
    input: string | readonly string[],
  ): Promise<GroupDocLike | Array<GroupDocLike>> {
    if (typeof input === "string") {
      return (await cached(ctx, `group:${input}`, () =>
        ctx.runQuery(config.component.group.get, {
          id: input,
        }),
      )) as GroupDocLike;
    }
    const groupIds = input;
    if (groupIds.length === 0) return [];
    const unique = Array.from(new Set(groupIds));
    const toFetch: string[] = [];
    for (const id of unique) {
      if (!ctxCacheHas(ctx, `group:${id}`)) {
        toFetch.push(id);
      }
    }
    if (toFetch.length > 0) {
      const docs = (await (ctx.runQuery as UntypedRunQuery)(config.component.group.get, {
        ids: toFetch,
      })) as Array<GroupDocLike>;
      for (let i = 0; i < toFetch.length; i += 1) {
        const id = toFetch[i]!;
        const value = docs[i] ?? null;
        void cached(ctx, `group:${id}`, () => Promise.resolve(value));
      }
    }
    return (await Promise.all(
      groupIds.map((id) =>
        cached(ctx, `group:${id}`, () =>
          ctx.runQuery(config.component.group.get, { id: id }),
        ),
      ),
    )) as Array<GroupDocLike>;
  }

  type GroupTree = {
    current: Doc<"Group">;
    parent: Doc<"Group"> | null;
    children: Array<Doc<"Group">>;
    ancestors: Array<Doc<"Group">>;
  };
  function groupGetEx(ctx: ComponentReadCtx, groupId: string): Promise<GroupDocLike>;
  function groupGetEx(
    ctx: ComponentReadCtx,
    groupIds: readonly string[],
  ): Promise<Array<GroupDocLike>>;
  function groupGetEx(
    ctx: ComponentReadCtx,
    selector: { slug: string },
  ): Promise<GroupDocLike>;
  function groupGetEx(
    ctx: ComponentReadCtx,
    groupId: string,
    opts: { tree: true },
  ): Promise<GroupTree | null>;
  async function groupGetEx(
    ctx: ComponentReadCtx,
    input: string | readonly string[] | { slug: string },
    opts?: { tree: true },
  ): Promise<GroupDocLike | Array<GroupDocLike> | GroupTree | null> {
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      "slug" in input
    ) {
      const { page } = await group.list(ctx, {
        where: { slug: (input as { slug: string }).slug },
        limit: 1,
      });
      return page[0] ?? null;
    }
    if (opts?.tree === true && typeof input === "string") {
      const current = await groupGet(ctx, input);
      if (current === null) return null;
      const parentId =
        typeof current.parentGroupId === "string" ? current.parentGroupId : null;
      const [parent, childrenPage] = await Promise.all([
        parentId !== null ? groupGet(ctx, parentId) : Promise.resolve(null),
        group.list(ctx, { where: { parentGroupId: input }, limit: 100 }),
      ]);
      const ancestors: Array<Doc<"Group">> = [];
      let walk = parentId;
      const seen = new Set<string>([input]);
      while (walk !== null && !seen.has(walk)) {
        seen.add(walk);
        const ancestor = await groupGet(ctx, walk);
        if (ancestor === null) break;
        ancestors.push(ancestor);
        walk =
          typeof ancestor.parentGroupId === "string"
            ? ancestor.parentGroupId
            : null;
      }
      return {
        current,
        parent,
        children: childrenPage.page,
        ancestors,
      };
    }
    return groupGet(ctx, input as string & readonly string[]);
  }

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
      const groupId = (await ctx.runMutation(config.component.group.create, data)) as string;
      return { groupId };
    },
    /**
     * Fetch a group document by ID, or a batch of group documents by IDs.
     * See {@link userGet} for the overload pattern.
     *
     * @example Single
     * ```ts
     * const group = await auth.group.get(ctx, groupId);
     * ```
     *
     * @example Batched
     * ```ts
     * const groups = await auth.group.get(ctx, membershipGroupIds);
     * ```
     *
     * @example By slug
     * ```ts
     * const group = await auth.group.get(ctx, { slug: "acme" });
     * ```
     *
     * @example With hierarchy
     * ```ts
     * const { current, parent, children, ancestors } =
     *   (await auth.group.get(ctx, groupId, { tree: true }))!;
     * ```
     */
    get: groupGetEx,
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
      return (await ctx.runQuery(config.component.group.list, {
        where: opts?.where,
        paginationOpts: {
          numItems: Math.min(Math.max(opts?.limit ?? 50, 1), 100),
          cursor: opts?.cursor ?? null,
        },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"Group">>;
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
    update: async (ctx: ComponentCtx, groupId: string, data: Record<string, unknown>) => {
      await ctx.runMutation(config.component.group.update, {
        groupId,
        data,
      });
      invalidateCtxCache(ctx, `group:${groupId}`);
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
      await ctx.runMutation(config.component.group.delete, { groupId });
      invalidateCtxCache(ctx, `group:${groupId}`);
      invalidateCtxCache(ctx, "member");
      invalidateCtxCache(ctx, "member-inspect");
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
      const result = (await (ctx.runQuery as UntypedRunQuery)(config.component.group.ancestors, {
        groupId: opts.groupId,
        maxDepth: opts.maxDepth,
        includeSelf: opts.includeSelf,
      })) as {
        ancestors: Array<Exclude<GroupDocLike, null>>;
        cycleDetected: boolean;
        maxDepthReached: boolean;
      };
      for (const ancestor of result.ancestors) {
        const id = ancestor._id as string;
        void cached(ctx, `group:${id}`, () => Promise.resolve(ancestor));
      }
      return result;
    },
  };

  type InspectResult = {
    membership: MemberDocLike;
    roleIds: string[];
    grants: string[];
  };
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
        const docs = (await (ctx.runQuery as UntypedRunQuery)(
          config.component.group.member.get,
          { userId, groupIds: toFetch },
        )) as Array<MemberDocLike>;
        for (let i = 0; i < toFetch.length; i += 1) {
          const groupId = toFetch[i]!;
          const value = (docs[i] ?? null) as MemberDocLike;
          void cached(ctx, `member-inspect:${userId}:${groupId}:n`, () =>
            Promise.resolve(value),
          );
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
          const membershipGrants = resolveGrantedPermissions(membershipRoleIds);
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
        (ctx.runQuery as UntypedRunQuery)(config.component.group.member.resolve, {
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
    const membershipGrants = resolveGrantedPermissions(membershipRoleIds);

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
      const memberId = (await ctx.runMutation(config.component.group.member.create, {
        ...data,
        roleIds,
      })) as string;
      invalidateCtxCache(ctx, `member-inspect:${data.userId}:${data.groupId}`);
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
    get: async (
      ctx: ComponentReadCtx,
      memberId: string,
    ): Promise<Doc<"GroupMember"> | null> => {
      return (await cached(ctx, `member:${memberId}`, () =>
        ctx.runQuery(config.component.group.member.get, {
          id: memberId,
        }),
      )) as Doc<"GroupMember"> | null;
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
    list: async <O extends MemberListOpts | undefined = undefined>(
      ctx: ComponentReadCtx,
      opts?: O,
    ): Promise<Paginated<MemberItem<NonNullable<O>>>> => {
      const page = (await ctx.runQuery(config.component.group.member.list, {
        where: opts?.where,
        paginationOpts: {
          numItems: Math.min(Math.max(opts?.limit ?? 50, 1), 100),
          cursor: opts?.cursor ?? null,
        },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"GroupMember">>;
      if (opts?.withGroup !== true && opts?.withGrants !== true) {
        return page as Paginated<MemberItem<NonNullable<O>>>;
      }
      const groupDocs = opts?.withGroup
        ? await group.get(ctx, page.page.map((m) => m.groupId))
        : null;
      const enrichedItems = await Promise.all(
        page.page.map(async (m, i) => {
          let enriched: Record<string, unknown> = { ...m };
          if (groupDocs !== null) {
            enriched.group = groupDocs[i] ?? null;
          }
          if (opts?.withGrants === true) {
            const resolved = await memberInspect(ctx, {
              userId: m.userId,
              groupId: m.groupId,
            });
            enriched.roleIds = resolved.roleIds;
            enriched.grants = resolved.grants;
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
     * @param memberId - The membership document ID.
     * @returns `{ memberId }`.
     *
     * @example
     * ```ts
     * await auth.member.delete(ctx, memberId);
     * ```
     */
    delete: async (ctx: ComponentCtx, memberId: string) => {
      await ctx.runMutation(config.component.group.member.delete, { memberId });
      invalidateCtxCache(ctx, "member");
      invalidateCtxCache(ctx, "member-inspect");
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
    update: async (ctx: ComponentCtx, memberId: string, data: Record<string, unknown>) => {
      const nextData = { ...data };
      if ("roleIds" in nextData) {
        nextData.roleIds = normalizeRoleIds(
          Array.isArray(nextData.roleIds) ? (nextData.roleIds as string[]) : undefined,
        );
      }
      await ctx.runMutation(config.component.group.member.update, {
        memberId,
        data: nextData,
      });
      invalidateCtxCache(ctx, `member:${memberId}`);
      invalidateCtxCache(ctx, "member-inspect");
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
     *
     * @example Batched across many groups (one RPC)
     * ```ts
     * const resolutions = await auth.member.inspect(ctx, {
     *   userId, groupIds: rootGroupIds,
     * });
     * ```
     */
    inspect: memberInspect,
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
      const roleFilter = validatedRoleIds.length > 0 ? new Set(validatedRoleIds) : null;
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
      if (roleFilter !== null && !result.roleIds.some((roleId: string) => roleFilter.has(roleId))) {
        throw new ConvexError({
          code: "NOT_A_MEMBER",
          message: "User is not a member of this group.",
          groupId: opts.groupId,
        });
      }
      const missingGrants = requiredGrants.filter((grant) => !result.grants.includes(grant));
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

  const readLastActiveGroup = (doc: Doc<"User"> | null): string | null => {
    const val = doc?.lastActiveGroup;
    return typeof val === "string" ? val : null;
  };

  /**
   * The current user's active group — the workspace selection persisted
   * natively on `User.lastActiveGroup`. Reuses the existing `get/set/clear`
   * vocabulary instead of bespoke `setActiveGroup`/`getActiveGroup`.
   */
  const active = {
    /**
     * Resolve the *effective* active group: the stored selection if it is
     * still a current membership, otherwise the user's first membership.
     *
     * @param ctx - Convex query/mutation context with `auth`.
     * @param opts.userId - Target user; defaults to the current session user.
     * @returns `{ groupId, group, membership }`, or `null` when there is no
     *   authenticated user or the user has no memberships.
     *
     * @example
     * ```ts
     * const active = await auth.group.active.get(ctx);
     * if (active) console.log(active.group.name);
     * ```
     */
    get: async (
      ctx: ComponentAuthReadCtx,
      opts?: { userId?: string },
    ): Promise<{
      groupId: string;
      group: Doc<"Group"> | null;
      membership: Doc<"GroupMember">;
    } | null> => {
      const userId = opts?.userId ?? (await getSessionUserId(ctx));
      if (userId === null || userId === undefined) return null;
      const [userDoc, { page: memberships }] = await Promise.all([
        user.get(ctx, userId),
        member.list(ctx, { where: { userId }, limit: 100 }),
      ]);
      if (memberships.length === 0) return null;
      const stored = readLastActiveGroup(userDoc);
      const chosen =
        memberships.find((m: Doc<"GroupMember">) => m.groupId === stored) ?? memberships[0];
      const groupDoc = await group.get(ctx, chosen.groupId);
      return { groupId: chosen.groupId, group: groupDoc, membership: chosen };
    },
    /**
     * Set the active group, validating the user is a member first.
     *
     * @param ctx - Convex mutation context with `auth`.
     * @param groupId - Group to activate.
     * @param opts.userId - Target user; defaults to the current session user.
     * @throws `NOT_SIGNED_IN` if no user, `NOT_A_MEMBER` if not a member.
     */
    set: async (
      ctx: ComponentCtx & { auth: Auth },
      groupId: string,
      opts?: { userId?: string },
    ): Promise<{ groupId: string }> => {
      const userId = opts?.userId ?? (await getSessionUserId(ctx));
      if (userId === null || userId === undefined) {
        throw new ConvexError({
          code: "NOT_SIGNED_IN",
          message: "Authentication required.",
        });
      }
      const { page } = await member.list(ctx, {
        where: { userId, groupId },
        limit: 1,
      });
      if (page.length === 0) {
        throw new ConvexError({
          code: "NOT_A_MEMBER",
          message: "User is not a member of this group.",
        });
      }
      await user.update(ctx, userId, { lastActiveGroup: groupId });
      return { groupId };
    },
    /**
     * Clear the stored active group selection.
     *
     * @param ctx - Convex mutation context with `auth`.
     * @param opts.userId - Target user; defaults to the current session user.
     */
    clear: async (
      ctx: ComponentCtx & { auth: Auth },
      opts?: { userId?: string },
    ): Promise<{ groupId: null }> => {
      const userId = opts?.userId ?? (await getSessionUserId(ctx));
      if (userId === null || userId === undefined) {
        throw new ConvexError({
          code: "NOT_SIGNED_IN",
          message: "Authentication required.",
        });
      }
      await user.update(ctx, userId, { lastActiveGroup: undefined });
      return { groupId: null };
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
      const token = generateRandomString(inviteTokenLength, inviteTokenAlphabet);
      const tokenHash = await sha256(token);
      const inviteId = (await ctx.runMutation(config.component.group.invite.create, {
        ...data,
        roleIds,
        tokenHash,
        status: "pending",
      })) as string;
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
    get: async (
      ctx: ComponentReadCtx,
      inviteId: string,
    ): Promise<Doc<"GroupInvite"> | null> => {
      return (await ctx.runQuery(config.component.group.invite.get, {
        id: inviteId,
      })) as Doc<"GroupInvite"> | null;
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
      get: async (
        ctx: ComponentReadCtx,
        token: string,
      ): Promise<Doc<"GroupInvite"> | null> => {
        const tokenHash = await sha256(token);
        return (await ctx.runQuery(config.component.group.invite.get, {
          tokenHash,
        })) as Doc<"GroupInvite"> | null;
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
      ): Promise<{
        inviteId: string;
        groupId: string | null;
        memberId?: string;
        inviteStatus: string;
        membershipStatus: string;
      }> => {
        const tokenHash = await sha256(args.token);
        const result = (await ctx.runMutation(
          config.component.group.invite.redeem,
          {
            tokenHash,
            acceptedByUserId: args.acceptedByUserId,
          },
        )) as {
          inviteId: string;
          groupId: string | null;
          memberId?: string;
          inviteStatus: string;
          membershipStatus: string;
        };
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
        orderBy?: "_creationTime" | "status" | "email" | "expiresTime" | "acceptedTime";
        order?: "asc" | "desc";
      },
    ) => {
      return (await ctx.runQuery(config.component.group.invite.list, {
        where: opts?.where,
        paginationOpts: {
          numItems: Math.min(Math.max(opts?.limit ?? 50, 1), 100),
          cursor: opts?.cursor ?? null,
        },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"GroupInvite">>;
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
    accept: async (ctx: ComponentCtx, inviteId: string, acceptedByUserId?: string) => {
      await ctx.runMutation(config.component.group.invite.accept, {
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
      await ctx.runMutation(config.component.group.invite.revoke, { inviteId });
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
      const keyId = (await ctx.runMutation(config.component.user.key.create, {
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
      const doc = (await ctx.runQuery(config.component.user.key.get, {
        hashedKey,
      })) as KeyDoc | null;
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
        const { limited, newState } = checkKeyRateLimit(k.rateLimit, k.rateLimitState ?? undefined);
        if (limited) {
          throw new ConvexError({
            code: "API_KEY_RATE_LIMITED",
            message: "API key rate limit exceeded. Please try again later.",
          });
        }
        patchData.rateLimitState = newState;
      }
      await ctx.runMutation(config.component.user.key.update, {
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
        orderBy?: "_creationTime" | "name" | "lastUsedAt" | "expiresAt" | "revoked";
        order?: "asc" | "desc";
      },
    ) => {
      return (await ctx.runQuery(config.component.user.key.list, {
        where: opts?.where,
        paginationOpts: {
          numItems: Math.min(Math.max(opts?.limit ?? 50, 1), 100),
          cursor: opts?.cursor ?? null,
        },
        orderBy: opts?.orderBy,
        order: opts?.order,
      })) as Paginated<Doc<"ApiKey">>;
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
    get: async (ctx: ComponentReadCtx, keyId: string): Promise<KeyDoc | null> => {
      const doc = (await ctx.runQuery(config.component.user.key.get, {
        id: keyId,
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
      await ctx.runMutation(config.component.user.key.update, { keyId, data });
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
      await ctx.runMutation(config.component.user.key.update, {
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
      await ctx.runMutation(config.component.user.key.delete, { keyId });
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
      const existing = await ctx.runQuery(config.component.user.key.get, {
        id: keyId,
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
      await ctx.runMutation(config.component.user.key.update, {
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
    active,
  };
}
