import {
  Auth,
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  actionGeneric,
  httpActionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { ConvexError, GenericId, v } from "convex/values";
import { throwAuthError, isAuthError } from "../errors";
import { parse as parseCookies, serialize as serializeCookie } from "cookie";
import { redirectToParamCookie, useRedirectToParam } from "../cookies";
import { FunctionReferenceFromExport } from "../types";
import {
  configDefaults,
  listAvailableProviders,
  materializeProvider,
} from "../providers";
import {
  AuthProviderConfig,
  ConvexAuthConfig,
  CorsConfig,
  HttpKeyContext,
} from "../types";
import { requireEnv } from "../utils";
import {
  ActionCtx,
  MutationCtx,
  Tokens,
  KeyDoc,
} from "./types";
export { Doc, Tokens } from "./types";
import {
  LOG_LEVELS,
  TOKEN_SUB_CLAIM_DIVIDER,
  logError,
  logWithLevel,
} from "./utils";
import { GetProviderOrThrowFunc } from "./provider";
import {
  callCreateAccountFromCredentials,
  callInvalidateSessions,
  callModifyAccount,
  callRetreiveAccountWithCredentials,
  callSignOut,
  callUserOAuth,
  callVerifierSignature,
  storeArgs,
  storeImpl,
} from "./mutations/index";
import { signInImpl } from "./signin";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import {
  generateApiKey,
  hashApiKey,
  buildScopeChecker,
  validateScopes,
  checkKeyRateLimit,
} from "./keys";
import {
  createOAuthAuthorizationURL,
  handleOAuthCallback,
} from "../oauth";
import type { OAuthMaterializedConfig } from "../types";

/**
 * The type of the signIn Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 */
export type SignInAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signIn"]
>;
/**
 * The type of the signOut Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 */
export type SignOutAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signOut"]
>;
/**
 * Configure the Convex Auth library. Returns an object with
 * functions and `auth` helper. You must export the functions
 * from `convex/auth.ts` to make them callable:
 *
 * ```ts filename="convex/auth.ts"
 * import { Auth } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const { auth, signIn, signOut, store } = Auth({
 *   component: components.auth,
 *   providers: [],
 * });
 * ```
 *
 * @returns An object with fields you should reexport from your
 *          `convex/auth.ts` file.
 */
export function Auth(config_: ConvexAuthConfig) {
  const config = configDefaults(config_);
  const hasOAuth = config.providers.some(
    (provider) => provider.type === "oauth",
  );
  const getProvider = (id: string, allowExtraProviders: boolean = false) => {
    return (
      config.providers.find((provider) => provider.id === id) ??
      (allowExtraProviders
        ? config.extraProviders.find((provider) => provider.id === id)
        : undefined)
    );
  };
  const getProviderOrThrow: GetProviderOrThrowFunc = (
    id: string,
    allowExtraProviders: boolean = false,
  ) => {
    const provider = getProvider(id, allowExtraProviders);
    if (provider === undefined) {
      const detail =
        `Provider \`${id}\` is not configured, ` +
        `available providers are ${listAvailableProviders(config, allowExtraProviders)}.`;
      logWithLevel(LOG_LEVELS.ERROR, detail);
      throwAuthError("PROVIDER_NOT_CONFIGURED", detail, { provider: id });
    }
    return provider;
  };
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

  const auth = {
    user: {
      /**
       * Get the current user's ID from the auth context, or `null` if
       * not signed in.
       *
       * @param ctx - Any Convex context with an `auth` field (query, mutation, or action).
       * @returns The user's `Id<"user">`, or `null` when unauthenticated.
       */
      current: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          return null;
        }
        const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return userId as GenericId<"user">;
      },
      /**
       * Get the current user's ID, or throw if not signed in.
       * Use this when authentication is required.
       *
       * @param ctx - Any Convex context with an `auth` field.
       * @returns The user's `Id<"user">`.
       * @throws `ConvexError` with code `NOT_SIGNED_IN` when unauthenticated.
       */
      require: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          throwAuthError("NOT_SIGNED_IN");
        }
        const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return userId as GenericId<"user">;
      },
      /**
       * Retrieve a user document by their ID.
       *
       * @param ctx - Convex context with `runQuery`.
       * @param userId - The user document ID.
       * @returns The user document, or `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, userId: string) => {
        return await ctx.runQuery(config.component.public.userGetById, { userId });
      },
      /**
       * Get the currently signed-in user's document, or `null` if not
       * signed in. Convenience combining `current()` + `get()`.
       *
       * @param ctx - Convex context with `auth` and `runQuery`.
       * @returns The user document, or `null` when unauthenticated.
       */
      viewer: async (ctx: ComponentAuthReadCtx) => {
        const userId = await auth.user.current(ctx);
        if (userId === null) {
          return null;
        }
        return await ctx.runQuery(config.component.public.userGetById, { userId });
      },
      /**
       * Update a user document with partial data.
       *
       * @param ctx - Convex context with `runMutation`.
       * @param userId - The user document ID.
       * @param data - Partial data to merge into the user document.
       */
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
      /**
       * Query a user's group memberships.
       */
      group: {
        /**
         * List all groups a user belongs to. Returns member records which
         * include the `groupId`, `role`, `status`, and `extend` for each.
         */
        list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
          return await ctx.runQuery(config.component.public.memberListByUser, opts);
        },
        /**
         * Look up a user's membership in a specific group. Returns the member
         * record (with role, status, extend) or `null` if the user is not
         * a member.
         */
        get: async (
          ctx: ComponentReadCtx,
          opts: { userId: string; groupId: string },
        ) => {
          return await ctx.runQuery(
            config.component.public.memberGetByGroupAndUser,
            opts,
          );
        },
      },
    },
    session: {
      /**
       * Get the current session ID from the auth context, or `null` if
       * not signed in.
       *
       * @param ctx - Any Convex context with an `auth` field.
       * @returns The session's `Id<"session">`, or `null` when unauthenticated.
       */
      current: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          return null;
        }
        const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return sessionId as GenericId<"session">;
      },
      /**
       * Invalidate sessions for a user, optionally preserving specific sessions.
       *
       * @param ctx - Convex action context.
       * @param args.userId - The user whose sessions to invalidate.
       * @param args.except - Session IDs to preserve (e.g. the current session).
       */
      invalidate: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: {
          userId: GenericId<"user">;
          except?: GenericId<"session">[];
        },
      ): Promise<void> => {
        const actionCtx = ctx as unknown as ActionCtx;
        return await callInvalidateSessions(actionCtx, args);
      },
    },
    account: {
      /**
       * Create an account and user for a credentials provider.
       *
       * @param ctx - Convex action context.
       * @param args - Provider ID, account credentials, profile data, and link flags.
       * @returns `{ account, user }` — the created account and user documents.
       */
      create: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: CreateAccountArgs,
      ) => {
        const actionCtx = ctx as unknown as ActionCtx;
        return await callCreateAccountFromCredentials(actionCtx, args);
      },
      /**
       * Retrieve an account and user for a credentials provider.
       *
       * @param ctx - Convex action context.
       * @param args - Provider ID and account credentials (id, optional secret).
       * @returns `{ account, user }` — the matched account and user documents.
       * @throws `ConvexError` with code `ACCOUNT_NOT_FOUND` when no match exists.
       */
      get: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: RetrieveAccountArgs,
      ) => {
        const actionCtx = ctx as unknown as ActionCtx;
        const result = await callRetreiveAccountWithCredentials(actionCtx, args);
        if (typeof result === "string") {
          throwAuthError("ACCOUNT_NOT_FOUND", result);
        }
        return result;
      },
      /**
       * Update credentials (secret) for an existing account.
       *
       * @param ctx - Convex action context.
       * @param args - Provider ID and new account credentials (id + secret).
       */
      updateCredentials: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: UpdateAccountCredentialsArgs,
      ): Promise<void> => {
        const actionCtx = ctx as unknown as ActionCtx;
        return await callModifyAccount(actionCtx, args);
      },
    },
    provider: {
      /**
       * Sign in via another provider, typically from a credentials flow.
       *
       * @param ctx - Convex action context.
       * @param provider - The provider config to sign in with.
       * @param args - Optional account ID and params.
       * @returns `{ userId, sessionId }` on success, or `null`.
       */
      signIn: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        provider: AuthProviderConfig,
        args: {
          accountId?: GenericId<"account">;
          params?: Record<string, unknown>;
        },
      ) => {
        const result = await signInImpl(
          enrichCtx(ctx),
          materializeProvider(provider),
          // params type widened: Record<string, unknown> → Record<string, any>
          args as { accountId?: GenericId<"account">; params?: Record<string, any> },
          {
            generateTokens: false,
            allowExtraProviders: true,
          },
        );
        return result.kind === "signedIn"
          ? result.signedIn !== null
            ? { userId: result.signedIn.userId, sessionId: result.signedIn.sessionId }
            : null
          : null;
      },
    },
    /**
     * Hierarchical group management. Groups can nest arbitrarily deep
     * via `parentGroupId`. A root group has no parent.
     *
     * ```ts
     * const groupId = await auth.group.create(ctx, { name: "Acme Corp" });
     * const subGroupId = await auth.group.create(ctx, {
     *   name: "Engineering",
     *   parentGroupId: groupId,
     * });
     * ```
     */
    group: {
      /**
       * Create a new group. Omit `parentGroupId` for a root-level group,
       * or provide it to create a nested group.
       *
       * @returns The ID of the newly created group.
       */
      create: async (
        ctx: ComponentCtx,
        data: {
          name: string;
          slug?: string;
          type?: string;
          parentGroupId?: string;
          extend?: Record<string, unknown>;
        },
      ): Promise<string> => {
        return (await ctx.runMutation(
          config.component.public.groupCreate,
          data,
        )) as string;
      },
      /**
       * Retrieve a group by its ID. Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, groupId: string) => {
        return await ctx.runQuery(config.component.public.groupGet, { groupId });
      },
      /**
       * List groups. When `parentGroupId` is provided, returns children of
       * that group. When omitted, returns root-level groups (no parent).
       */
      list: async (
        ctx: ComponentReadCtx,
        opts?: { type?: string; parentGroupId?: string },
      ) => {
        return await ctx.runQuery(config.component.public.groupList, {
          type: opts?.type,
          parentGroupId: opts?.parentGroupId,
        });
      },
      /**
       * Update a group's fields (name, slug, extend, parentGroupId).
       */
      update: async (
        ctx: ComponentCtx,
        groupId: string,
        data: Record<string, unknown>,
      ) => {
        await ctx.runMutation(config.component.public.groupUpdate, { groupId, data });
      },
      /**
       * Delete a group and cascade to all descendants. Deletes child groups
       * (recursively), all members, and all invites for this group and its
       * descendants.
       */
      delete: async (ctx: ComponentCtx, groupId: string) => {
        await ctx.runMutation(config.component.public.groupDelete, { groupId });
      },

      /**
       * Manage group membership. A member links a user to a group with an
       * application-defined role string (e.g. "owner", "admin", "member").
       *
       * The auth component stores roles but does not enforce access control.
       * Your application defines what each role means.
       */
      member: {
        /**
         * Add a user as a member of a group.
         *
         * @param data.groupId - The group to add the member to.
         * @param data.userId - The user to add.
         * @param data.role - Application-defined role (e.g. "owner", "admin", "member").
         * @param data.status - Optional membership status (e.g. "active", "suspended").
         * @param data.extend - Optional arbitrary JSON extension data.
         * @throws ConvexError with code `DUPLICATE_MEMBERSHIP` if the user is
         * already a member of the target group.
         * @returns The ID of the new member record.
         */
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
        /**
         * Retrieve a member record by its ID. Returns `null` if not found.
         */
        get: async (ctx: ComponentReadCtx, memberId: string) => {
          return await ctx.runQuery(config.component.public.memberGet, { memberId });
        },
        /**
         * List all members of a group.
         */
        list: async (ctx: ComponentReadCtx, opts: { groupId: string }) => {
          return await ctx.runQuery(config.component.public.memberList, opts);
        },
        /**
         * Remove a member from a group by deleting the member record.
         */
        remove: async (ctx: ComponentCtx, memberId: string) => {
          await ctx.runMutation(config.component.public.memberRemove, { memberId });
        },
        /**
         * Update a member's fields (role, status, extend).
         *
         * ```ts
         * await auth.group.member.update(ctx, memberId, { role: "admin" });
         * ```
         */
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
      },

    },
    /**
     * Manage platform-level invitations.
     *
     * Invites can optionally target a group by setting `groupId`, but they do
     * not require groups and can be used in apps with user-only collaboration.
     */
    invite: {
      /**
       * Create a new invitation.
       *
       * @param data.groupId - Optional group to invite the user into.
       * @param data.invitedByUserId - Optional user sending the invitation
       *   (omit for CLI-generated invites).
       * @param data.email - Optional email of the invitee (omit for
       *   CLI-generated invite links where the email is unknown upfront).
       * @param data.tokenHash - Hashed token for secure acceptance.
       * @param data.role - Optional role to assign on acceptance.
       * @param data.status - Initial status (typically "pending").
       * @param data.expiresTime - Optional expiration timestamp (omit for
       *   single-use, non-expiring invites).
       * @param data.extend - Optional arbitrary JSON extension data.
       * @throws ConvexError with code `DUPLICATE_INVITE` if a pending invite
       * already exists for this email and scope.
       * @returns The ID of the new invite record.
       */
      create: async (
        ctx: ComponentCtx,
        data: {
          groupId?: string;
          invitedByUserId?: string;
          email?: string;
          tokenHash: string;
          role?: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          expiresTime?: number;
          extend?: Record<string, unknown>;
        },
      ): Promise<string> => {
        return (await ctx.runMutation(config.component.public.inviteCreate, data)) as string;
      },
      /**
       * Retrieve an invite by its ID. Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, inviteId: string) => {
        return await ctx.runQuery(config.component.public.inviteGet, { inviteId });
      },
      /**
       * Retrieve an invite by its token hash. Returns `null` if not found.
       */
      getByTokenHash: async (ctx: ComponentReadCtx, tokenHash: string) => {
        return await ctx.runQuery(config.component.public.inviteGetByTokenHash, { tokenHash });
      },
      /**
       * List invites, optionally filtered by group and/or status.
       */
      list: async (
        ctx: ComponentReadCtx,
        opts?: {
          groupId?: string;
          status?: "pending" | "accepted" | "revoked" | "expired";
        },
      ) => {
        return await ctx.runQuery(config.component.public.inviteList, {
          groupId: opts?.groupId,
          status: opts?.status,
        });
      },
      /**
       * Accept an invitation. Marks the invite as "accepted" and records
       * the timestamp. If the invite has a group, the caller is responsible
       * for creating the member record via `auth.group.member.add` in the
       * same Convex mutation for transactional safety.
       *
       * @param ctx - Convex context with `runMutation`.
       * @param inviteId - The invite document ID.
       * @param acceptedByUserId - User accepting the invite (recorded for audit).
       * @throws `ConvexError` with code `INVITE_NOT_FOUND` when the invite does not exist.
       * @throws `ConvexError` with code `INVITE_NOT_PENDING` when the invite is not in `pending` status.
       *
       * @example
       * ```ts
       * export const acceptInvite = mutation({
       *   args: { inviteId: v.string() },
       *   handler: async (ctx, { inviteId }) => {
       *     const userId = await auth.user.require(ctx);
       *     const invite = await auth.invite.get(ctx, inviteId);
       *     if (!invite) throw new Error("Invite not found");
       *
       *     await auth.invite.accept(ctx, inviteId);
       *     if (invite.groupId) {
       *       await auth.group.member.add(ctx, {
       *         groupId: invite.groupId,
       *         userId,
       *         role: invite.role,
       *       });
       *     }
       *   },
       * });
       * ```
       */
      accept: async (ctx: ComponentCtx, inviteId: string, acceptedByUserId?: string) => {
        await ctx.runMutation(config.component.public.inviteAccept, {
          inviteId,
          ...(acceptedByUserId ? { acceptedByUserId } : {}),
        });
      },
      /**
       * Revoke a pending invitation.
       *
       * @param ctx - Convex context with `runMutation`.
       * @param inviteId - The invite document ID.
       * @throws `ConvexError` with code `INVITE_NOT_FOUND` when the invite does not exist.
       * @throws `ConvexError` with code `INVITE_NOT_PENDING` when the invite is not in `pending` status.
       */
      revoke: async (ctx: ComponentCtx, inviteId: string) => {
        await ctx.runMutation(config.component.public.inviteRevoke, { inviteId });
      },
    },
    /**
     * Manage passkey credentials for users.
     *
     * ```ts
     * const passkeys = await auth.passkey.list(ctx, { userId });
     * await auth.passkey.rename(ctx, passkeyId, "MacBook Touch ID");
     * await auth.passkey.remove(ctx, passkeyId);
     * ```
     */
    passkey: {
      /**
       * List all passkeys for a user.
       *
       * @param opts.userId - The user whose passkeys to list.
       * @returns Array of passkey records with credentialId, name, deviceType,
       * backedUp, createdAt, and lastUsedAt.
       */
      list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
        return await ctx.runQuery(
          config.component.public.passkeyListByUserId,
          opts,
        );
      },
      /**
       * Rename a passkey (set a user-friendly display name).
       *
       * @param passkeyId - The passkey document ID.
       * @param name - New display name (e.g. "MacBook Touch ID").
       */
      rename: async (ctx: ComponentCtx, passkeyId: string, name: string) => {
        await ctx.runMutation(
          config.component.public.passkeyUpdateMeta,
          { passkeyId, data: { name } },
        );
      },
      /**
       * Delete a passkey credential.
       *
       * @param passkeyId - The passkey document ID to remove.
       */
      remove: async (ctx: ComponentCtx, passkeyId: string) => {
        await ctx.runMutation(
          config.component.public.passkeyDelete,
          { passkeyId },
        );
      },
    },
    /**
     * Manage TOTP two-factor authentication enrollments for users.
     *
     * ```ts
     * const enrollments = await auth.totp.list(ctx, { userId });
     * await auth.totp.remove(ctx, totpId);
     * ```
     */
    totp: {
      /**
       * List all TOTP enrollments for a user.
       *
       * @param opts.userId - The user whose enrollments to list.
       * @returns Array of TOTP enrollment records.
       */
      list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
        return await ctx.runQuery(
          config.component.public.totpListByUserId,
          opts,
        );
      },
      /**
       * Delete a TOTP enrollment.
       *
       * @param totpId - The TOTP document ID to remove.
       */
      remove: async (ctx: ComponentCtx, totpId: string) => {
        await ctx.runMutation(
          config.component.public.totpDelete,
          { totpId },
        );
      },
    },
    /**
     * Manage API keys for programmatic access.
     *
     * Keys use SHA-256 hashing (via `@oslojs/crypto`) and support
     * scoped resource:action permissions with optional per-key rate limiting.
     *
     * ```ts
     * const { keyId, raw } = await auth.key.create(ctx, {
     *   userId,
     *   name: "CI Pipeline",
     *   scopes: [{ resource: "users", actions: ["read", "list"] }],
     * });
     * // raw = "sk_live_abc123..." — show once, never stored
     *
     * const result = await auth.key.verify(ctx, rawKey);
     * result.scopes.can("users", "read"); // true
     * ```
     */
    key: {
      /**
       * Create a new API key. Returns the raw key **once** — it cannot
       * be retrieved again after creation.
       *
       * @param opts.userId - The user this key belongs to.
       * @param opts.name - Human-readable name (e.g. "CI Pipeline").
       * @param opts.scopes - Resource:action permissions for this key.
       * @param opts.rateLimit - Optional per-key rate limit override.
       * @param opts.expiresAt - Optional expiration timestamp.
       * @returns `{ keyId, raw }` where `raw` is the full key string.
       */
      create: async (
        ctx: ComponentCtx,
        opts: {
          userId: string;
          name: string;
          scopes: import("../types.js").KeyScope[];
          rateLimit?: { maxRequests: number; windowMs: number };
          expiresAt?: number;
        },
      ): Promise<{ keyId: string; raw: string }> => {
        const prefix = config.apiKeys?.prefix ?? "sk_live_";

        // Validate scopes against config if defined
        validateScopes(opts.scopes, config.apiKeys?.scopes);

        const { raw, hashedKey, displayPrefix } = await generateApiKey(prefix);

        const keyId = (await ctx.runMutation(
          config.component.public.keyInsert,
          {
            userId: opts.userId,
            prefix: displayPrefix,
            hashedKey,
            name: opts.name,
            scopes: opts.scopes,
            rateLimit: opts.rateLimit ?? config.apiKeys?.defaultRateLimit,
            expiresAt: opts.expiresAt,
          },
        )) as string;

        return { keyId, raw };
      },

      /**
       * Verify a raw API key string. Returns the userId and a scope checker
       * if the key is valid, not revoked, not expired, and not rate-limited.
       *
       * Also updates `lastUsedAt` and rate limit state as a side effect.
       *
       * @throws Error if the key is invalid, revoked, expired, or rate-limited.
       */
      verify: async (
        ctx: ComponentCtx,
        rawKey: string,
      ): Promise<{
        userId: string;
        keyId: string;
        scopes: import("../types.js").ScopeChecker;
      }> => {
        const hashedKey = await hashApiKey(rawKey);

        const key = (await ctx.runQuery(
          config.component.public.keyGetByHashedKey,
          { hashedKey },
        )) as KeyDoc | null;
        if (!key) {
          throwAuthError("INVALID_API_KEY");
        }
        if (key.revoked) {
          throwAuthError("API_KEY_REVOKED");
        }
        if (key.expiresAt && key.expiresAt < Date.now()) {
          throwAuthError("API_KEY_EXPIRED");
        }

        // Check per-key rate limit
        const patchData: Record<string, unknown> = { lastUsedAt: Date.now() };

        if (key.rateLimit) {
          const { limited, newState } = checkKeyRateLimit(
            key.rateLimit,
            key.rateLimitState ?? undefined,
          );
          if (limited) {
            throwAuthError("API_KEY_RATE_LIMITED");
          }
          patchData.rateLimitState = newState;
        }

        // Update lastUsedAt (and rate limit state if applicable)
        await ctx.runMutation(config.component.public.keyPatch, {
          keyId: key._id,
          data: patchData,
        });

        return {
          userId: key.userId,
          keyId: key._id,
          scopes: buildScopeChecker(key.scopes),
        };
      },

      /**
       * List all API keys for a user.
       * Never includes the raw key — only the display prefix.
       */
      list: async (ctx: ComponentReadCtx, opts: { userId: string }): Promise<KeyDoc[]> => {
        return (await ctx.runQuery(
          config.component.public.keyListByUserId,
          { userId: opts.userId },
        )) as KeyDoc[];
      },

      /**
       * Get a single API key by its document ID.
       * Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, keyId: string): Promise<KeyDoc | null> => {
        return (await ctx.runQuery(
          config.component.public.keyGetById,
          { keyId },
        )) as KeyDoc | null;
      },

      /**
       * Update an API key's metadata (name, scopes, rate limit).
       */
      update: async (
        ctx: ComponentCtx,
        keyId: string,
        data: {
          name?: string;
          scopes?: import("../types.js").KeyScope[];
          rateLimit?: { maxRequests: number; windowMs: number };
        },
      ) => {
        if (data.scopes) {
          validateScopes(data.scopes, config.apiKeys?.scopes);
        }
        await ctx.runMutation(config.component.public.keyPatch, {
          keyId,
          data,
        });
      },

      /**
       * Revoke an API key (soft delete). The key record is preserved
       * for audit purposes but can no longer be used for authentication.
       */
      revoke: async (ctx: ComponentCtx, keyId: string) => {
        await ctx.runMutation(config.component.public.keyPatch, {
          keyId,
          data: { revoked: true },
        });
      },

      /**
       * Hard delete an API key record.
       */
      remove: async (ctx: ComponentCtx, keyId: string) => {
        await ctx.runMutation(config.component.public.keyDelete, {
          keyId,
        });
      },
    },
    /**
     * HTTP namespace — route registration and Bearer-authenticated endpoints.
     */
    http: {
      /**
       * Register core HTTP routes for JWT verification and OAuth sign-in.
       *
       * ```ts
       * import { httpRouter } from "convex/server";
       * import { auth } from "./auth";
       *
       * const http = httpRouter();
       *
       * auth.http.add(http);
       *
       * export default http;
       * ```
       *
       * The following routes are handled always:
       *
       * - `/.well-known/openid-configuration`
       * - `/.well-known/jwks.json`
       *
       * The following routes are handled if OAuth is configured:
       *
       * - `/api/auth/signin/*`
       * - `/api/auth/callback/*`
       *
       * @param http your HTTP router
       */
      add: (http: HttpRouter) => {
      http.route({
        path: "/.well-known/openid-configuration",
        method: "GET",
        handler: httpActionGeneric(async () => {
          return new Response(
            JSON.stringify({
              issuer: requireEnv("CONVEX_SITE_URL"),
              jwks_uri:
                requireEnv("CONVEX_SITE_URL") + "/.well-known/jwks.json",
              authorization_endpoint:
                requireEnv("CONVEX_SITE_URL") + "/oauth/authorize",
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control":
                  "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
              },
            },
          );
        }),
      });

      http.route({
        path: "/.well-known/jwks.json",
        method: "GET",
        handler: httpActionGeneric(async () => {
          return new Response(requireEnv("JWKS"), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control":
                "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
            },
          });
        }),
      });

      if (hasOAuth) {
        http.route({
          pathPrefix: "/api/auth/signin/",
          method: "GET",
          handler: httpActionGeneric(
            convertErrorsToResponse(400, async (ctx, request) => {
              const url = new URL(request.url);
              const pathParts = url.pathname.split("/");
              const providerId = pathParts.at(-1)!;
              if (providerId === null) {
                throwAuthError("OAUTH_MISSING_PROVIDER");
              }
              const verifier = url.searchParams.get("code");
              if (verifier === null) {
                throwAuthError("OAUTH_MISSING_VERIFIER");
              }
              const provider = getProviderOrThrow(providerId);

              const oauthConfig = provider as OAuthMaterializedConfig;
              const { redirect, cookies, signature } =
                await createOAuthAuthorizationURL(
                  providerId,
                  oauthConfig.provider,
                  oauthConfig,
                );

              await callVerifierSignature(ctx, {
                verifier,
                signature,
              });

              const redirectTo = url.searchParams.get("redirectTo");
              if (redirectTo !== null) {
                cookies.push(redirectToParamCookie(providerId, redirectTo));
              }

              const headers = new Headers({ Location: redirect });
              for (const { name, value, options } of cookies) {
                headers.append(
                  "Set-Cookie",
                  serializeCookie(name, value, options as any),
                );
              }

              return new Response(null, { status: 302, headers });
            }),
          ),
        });

        const callbackAction = httpActionGeneric(
          async (genericCtx, request) => {
            const ctx = genericCtx as unknown as ActionCtx;
            const url = new URL(request.url);
            const pathParts = url.pathname.split("/");
            const providerId = pathParts.at(-1)!;
            logWithLevel(
              LOG_LEVELS.DEBUG,
              "Handling OAuth callback for provider:",
              providerId,
            );
            const provider = getProviderOrThrow(providerId);

            const cookies = getCookies(request);

            const maybeRedirectTo = useRedirectToParam(provider.id, cookies);

            const destinationUrl = await redirectAbsoluteUrl(config, {
              redirectTo: maybeRedirectTo?.redirectTo,
            });

            const params = url.searchParams;

            // Handle OAuth providers that use formData (such as Apple)
            if (
              request.headers.get("Content-Type") ===
              "application/x-www-form-urlencoded"
            ) {
              const formData = await request.formData();
              for (const [key, value] of formData.entries()) {
                if (typeof value === "string") {
                  params.append(key, value);
                }
              }
            }

            try {
              const oauthConfig = provider as OAuthMaterializedConfig;
              const result = await handleOAuthCallback(
                providerId,
                oauthConfig.provider,
                oauthConfig,
                Object.fromEntries(params.entries()),
                cookies,
              );
              const { id: profileId, ...profileData } = result.profile;
              const { signature } = result;

              const verificationCode = await callUserOAuth(ctx, {
                provider: providerId,
                providerAccountId: profileId,
                profile: profileData,
                signature,
              });

              return new Response(null, {
                status: 302,
                headers: {
                  Location: setURLSearchParam(
                    destinationUrl,
                    "code",
                    verificationCode,
                  ),
                  "Cache-Control": "must-revalidate",
                },
              });
            } catch (error) {
              logError(error);
              return Response.redirect(destinationUrl);
            }
          },
        );

        http.route({
          pathPrefix: "/api/auth/callback/",
          method: "GET",
          handler: callbackAction,
        });

        http.route({
          pathPrefix: "/api/auth/callback/",
          method: "POST",
          handler: callbackAction,
        });
      }
    },

      /**
       * Wrap an HTTP action handler with Bearer token authentication.
       *
       * Extracts the `Authorization: Bearer <key>` header, verifies the
       * API key via `auth.key.verify()`, and injects `ctx.key` with the
       * verified key info. Returns structured JSON error responses for
       * missing/invalid/revoked/expired/rate-limited keys.
       *
       * If the handler returns a plain object, it is auto-wrapped in a
       * `200 JSON` response. If it returns a `Response`, CORS headers
       * are merged and the response is passed through.
       *
       * ```ts
       * const handler = auth.http.action(async (ctx, request) => {
       *   const data = await ctx.runQuery(api.data.get, { userId: ctx.key.userId });
       *   return { data };
       * });
       * http.route({ path: "/api/data", method: "GET", handler });
       * ```
       *
       * @param handler - Receives enriched `ctx` (with `ctx.key`) and the raw `Request`.
       * @param options.scope - Optional scope check; returns 403 if the key lacks permission.
       * @param options.cors - CORS config; defaults to permissive (`*`).
       */
      action: (
        handler: (
          ctx: GenericActionCtx<GenericDataModel> & HttpKeyContext,
          request: Request,
        ) => Promise<Response | Record<string, unknown>>,
        options?: {
          scope?: { resource: string; action: string };
          cors?: CorsConfig;
        },
      ) => {
        const corsConfig = options?.cors ?? {};
        const corsHeaders: Record<string, string> = {
          "Access-Control-Allow-Origin": corsConfig.origin ?? "*",
          "Access-Control-Allow-Methods":
            corsConfig.methods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers":
            corsConfig.headers ?? "Content-Type,Authorization",
        };

        const jsonError = (
          status: number,
          code: string,
          message: string,
        ) =>
          new Response(JSON.stringify({ error: message, code }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        return httpActionGeneric(async (genericCtx, request) => {
          const ctx = genericCtx as unknown as GenericActionCtx<GenericDataModel>;

          try {
            // 1. Extract Bearer token
            const authHeader = request.headers.get("Authorization");
            if (!authHeader?.startsWith("Bearer ")) {
              return jsonError(
                401,
                "MISSING_BEARER_TOKEN",
                "Missing or malformed Authorization: Bearer header.",
              );
            }
            const rawKey = authHeader.slice(7);

            // 2. Verify API key
            let keyResult: { userId: string; keyId: string; scopes: import("../types.js").ScopeChecker };
            try {
              keyResult = await auth.key.verify(ctx, rawKey);
            } catch (error: unknown) {
              if (isAuthError(error)) {
                const { code, message } = error.data as { code: string; message: string };
                return jsonError(403, code, message);
              }
              throw error;
            }

            // 3. Optional scope check
            if (options?.scope) {
              if (!keyResult.scopes.can(options.scope.resource, options.scope.action)) {
                return jsonError(
                  403,
                  "SCOPE_CHECK_FAILED",
                  "This API key does not have the required permissions.",
                );
              }
            }

            // 4. Enrich context with key info
            const enrichedCtx = Object.assign(ctx, {
              key: {
                userId: keyResult.userId,
                keyId: keyResult.keyId,
                scopes: keyResult.scopes,
              },
            });

            // 5. Call handler
            const result = await handler(enrichedCtx, request);

            // 6. Auto-wrap plain objects as JSON responses
            if (result instanceof Response) {
              // Merge CORS headers into existing response
              const headers = new Headers(result.headers);
              for (const [k, val] of Object.entries(corsHeaders)) {
                if (!headers.has(k)) headers.set(k, val);
              }
              return new Response(result.body, {
                status: result.status,
                statusText: result.statusText,
                headers,
              });
            }

            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } catch (error: unknown) {
            logError(error);
            return jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
          }
        });
      },

      /**
       * Register a Bearer-authenticated route **and** its OPTIONS preflight
       * in a single call.
       *
       * ```ts
       * auth.http.route(http, {
       *   path: "/api/messages",
       *   method: "POST",
       *   handler: async (ctx, request) => {
       *     const { body } = await request.json();
       *     await ctx.runMutation(internal.messages.sendAsUser, {
       *       userId: ctx.key.userId,
       *       body,
       *     });
       *     return { success: true };
       *   },
       * });
       * ```
       *
       * @param http - The Convex HTTP router.
       * @param routeConfig.path - The URL path to match.
       * @param routeConfig.method - HTTP method (GET, POST, PUT, PATCH, DELETE).
       * @param routeConfig.handler - Receives enriched `ctx` (with `ctx.key`) and the raw `Request`.
       * @param routeConfig.scope - Optional scope check; returns 403 if the key lacks permission.
       * @param routeConfig.cors - CORS config; defaults to permissive (`*`).
       */
      route: (
        http: HttpRouter,
        routeConfig: {
          path: string;
          method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
          handler: (
            ctx: GenericActionCtx<GenericDataModel> & HttpKeyContext,
            request: Request,
          ) => Promise<Response | Record<string, unknown>>;
          scope?: { resource: string; action: string };
          cors?: CorsConfig;
        },
      ) => {
        const corsConfig = routeConfig.cors ?? {};
        const corsHeaders: Record<string, string> = {
          "Access-Control-Allow-Origin": corsConfig.origin ?? "*",
          "Access-Control-Allow-Methods":
            corsConfig.methods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers":
            corsConfig.headers ?? "Content-Type,Authorization",
        };

        // Register OPTIONS preflight
        http.route({
          path: routeConfig.path,
          method: "OPTIONS",
          handler: httpActionGeneric(async () => {
            return new Response(null, { status: 204, headers: corsHeaders });
          }),
        });

        // Register the main route with Bearer auth wrapping
        http.route({
          path: routeConfig.path,
          method: routeConfig.method,
          handler: auth.http.action(routeConfig.handler, {
            scope: routeConfig.scope,
            cors: routeConfig.cors,
          }),
        });
      },
    },
  };
  const enrichCtx = <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => ({
    ...ctx,
    auth: {
      ...ctx.auth,
      config,
      account: auth.account,
      session: auth.session,
      provider: auth.provider,
    },
  });

  return {
    /**
     * Helper for configuring HTTP actions.
     */
    auth,
    /**
     * Action called by the client to sign the user in.
     *
     * Also used for refreshing the session.
     */
    signIn: actionGeneric({
      args: {
        provider: v.optional(v.string()),
        params: v.optional(v.any()),
        verifier: v.optional(v.string()),
        refreshToken: v.optional(v.string()),
        calledBy: v.optional(v.string()),
      },
      handler: async (
        ctx,
        args,
      ): Promise<{
        redirect?: string;
        verifier?: string;
        tokens?: Tokens | null;
        started?: boolean;
        options?: Record<string, any>;
        totpRequired?: boolean;
        totpSetup?: { uri: string; secret: string; totpId: string };
        deviceCode?: {
          deviceCode: string;
          userCode: string;
          verificationUri: string;
          verificationUriComplete: string;
          expiresIn: number;
          interval: number;
        };
      }> => {
        if (args.calledBy !== undefined) {
          logWithLevel("INFO", `\`auth:signIn\` called by ${args.calledBy}`);
        }
        const provider =
          args.provider !== undefined
            ? getProviderOrThrow(args.provider)
            : null;
        const result = await signInImpl(enrichCtx(ctx), provider, args, {
          generateTokens: true,
          allowExtraProviders: false,
        });
        switch (result.kind) {
          case "redirect":
            return { redirect: result.redirect, verifier: result.verifier };
          case "signedIn":
          case "refreshTokens":
            return { tokens: result.signedIn?.tokens ?? null };
          case "started":
            return { started: true };
          case "passkeyOptions":
            return { options: result.options, verifier: result.verifier };
          case "totpRequired":
            return { totpRequired: true, verifier: result.verifier };
          case "totpSetup":
            return { totpSetup: { uri: result.uri, secret: result.secret, totpId: result.totpId }, verifier: result.verifier };
          case "deviceCode":
            return {
              deviceCode: {
                deviceCode: result.deviceCode,
                userCode: result.userCode,
                verificationUri: result.verificationUri,
                verificationUriComplete: result.verificationUriComplete,
                expiresIn: result.expiresIn,
                interval: result.interval,
              },
            };
          default: {
            const _typecheck: never = result;
            throwAuthError("INTERNAL_ERROR", `Unexpected result from signIn, ${String(result)}`);
          }
        }
      },
    }),
    /**
     * Action called by the client to invalidate the current session.
     */
    signOut: actionGeneric({
      args: {},
      handler: async (ctx) => {
        await callSignOut(ctx);
      },
    }),

    /**
     * Internal mutation used by the library to read and write
     * to the database during signin and signout.
     */
    store: internalMutationGeneric({
      args: storeArgs,
      handler: async (ctx: MutationCtx, args) => {
        return storeImpl(ctx, args, getProviderOrThrow, config);
      },
    }),

  };
}

function convertErrorsToResponse(
  errorStatusCode: number,
  action: (ctx: GenericActionCtx<any>, request: Request) => Promise<Response>,
) {
  return async (ctx: GenericActionCtx<any>, request: Request) => {
    try {
      return await action(ctx, request);
    } catch (error) {
      if (isAuthError(error)) {
        return new Response(
          JSON.stringify({ code: error.data.code, message: error.data.message }),
          {
            status: errorStatusCode,
            headers: { "Content-Type": "application/json" },
          },
        );
      } else if (error instanceof ConvexError) {
        return new Response(null, {
          status: errorStatusCode,
          statusText: typeof error.data === "string" ? error.data : "Error",
        });
      } else {
        logError(error);
        return new Response(null, {
          status: 500,
          statusText: "Internal Server Error",
        });
      }
    }
  };
}
function getCookies(request: Request): Record<string, string | undefined> {
  return parseCookies(request.headers.get("Cookie") ?? "");
}
