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
import { parse as parseCookies, serialize as serializeCookie } from "cookie";

import { redirectToParamCookie, useRedirectToParam } from "./cookies";
import { isAuthError } from "./errors";
import { AuthError, Fx } from "./fx";
import {
  generateApiKey,
  hashApiKey,
  buildScopeChecker,
  checkKeyRateLimit,
} from "./keys";
import {
  callCreateAccountFromCredentials,
  callInvalidateSessions,
  callModifyAccount,
  callRetrieveAccountWithCredentials,
  callSignOut,
  callUserOAuth,
  callVerifierSignature,
  storeArgs,
  storeImpl,
} from "./mutations/index";
import { createOAuthAuthorizationURL, handleOAuthCallback } from "./oauth";
import { GetProviderOrThrowFunc } from "./provider";
import {
  configDefaults,
  listAvailableProviders,
  materializeProvider,
} from "./providers";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import { signInImpl } from "./signin";
import {
  createEnterpriseSamlMetadataXml,
  createEnterpriseSamlSignInRequest,
  createEnterpriseOidcRuntime,
  createServiceProviderMetadata,
  createSamlPostBindingResponse,
  encodeEnterpriseSamlRelayState,
  enterpriseOidcProviderId,
  enterpriseSamlProviderId,
  getEnterpriseOidcUrls,
  getSamlServiceProviderOptions,
  isEnterpriseSamlSourceActive,
  parseEnterpriseSamlLoginResponse,
  parseEnterpriseSamlLogoutMessage,
  getOidcConfig,
  getSamlConfig,
  normalizeDomain,
  parseScimListRequest,
  parseScimPath,
  parseSamlIdpMetadata,
  profileFromSamlExtract,
  SCIM_GROUP_SCHEMA_ID,
  SCIM_USER_SCHEMA_ID,
  scimError,
  scimJson,
  serializeScimGroup,
  serializeScimUser,
  upsertProtocolConfig,
  validateEnterpriseSamlLoginRelayState,
} from "./sso";
import { MutationCtx, KeyDoc } from "./types";
import type { Tokens } from "./types";
import type { FunctionReferenceFromExport } from "./types";
import type { KeyScope, ScopeChecker } from "./types";
import {
  AuthProviderConfig,
  ConvexAuthConfig,
  CorsConfig,
  HttpKeyContext,
  UserOrderBy,
  UserWhere,
} from "./types";
import type { OAuthMaterializedConfig } from "./types";
import {
  generateRandomString,
  LOG_LEVELS,
  TOKEN_SUB_CLAIM_DIVIDER,
  logError,
  logWithLevel,
  sha256,
} from "./utils";
import { requireEnv } from "./utils";

/**
 * The type of the signIn Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 *
 * @internal
 */
export type SignInAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signIn"]
>;

/** @internal */
export type SignInActionResult =
  | { kind: "signedIn"; tokens: Tokens | null }
  | { kind: "redirect"; redirect: string; verifier: string }
  | { kind: "started" }
  | { kind: "passkeyOptions"; options: Record<string, any>; verifier: string }
  | { kind: "totpRequired"; verifier: string }
  | {
      kind: "totpSetup";
      totpSetup: { uri: string; secret: string; totpId: string };
      verifier: string;
    }
  | {
      kind: "deviceCode";
      deviceCode: {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresIn: number;
        interval: number;
      };
    };
/**
 * The type of the signOut Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 *
 * @internal
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
 * import { createAuth } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const auth = createAuth(components.auth, {
 *   providers: [],
 * });
 * export const { signIn, signOut, store } = auth;
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
  const hasSSO = config.providers.some((provider) => provider.type === "sso");
  const getProviderOrThrow: GetProviderOrThrowFunc = (
    id: string,
    allowExtraProviders: boolean = false,
  ) => {
    const provider =
      config.providers.find(
        (configuredProvider) => configuredProvider.id === id,
      ) ??
      (allowExtraProviders
        ? config.extraProviders.find(
            (configuredProvider) => configuredProvider.id === id,
          )
        : undefined);
    if (provider === undefined) {
      const detail =
        `Provider \`${id}\` is not configured, ` +
        `available providers are ${listAvailableProviders(config, allowExtraProviders)}.`;
      logWithLevel(LOG_LEVELS.ERROR, detail);
      throw new AuthError("PROVIDER_NOT_CONFIGURED", detail, {
        provider: id,
      }).toConvexError();
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

  const INVITE_TOKEN_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const INVITE_TOKEN_LENGTH = 48;

  const enterpriseNotFoundError = "Enterprise not found.";

  const ENTERPRISE_CONTROL_ROUTE_BASE = "/api/auth/sso";

  const recordEnterpriseAuditEvent = async (
    ctx: ComponentCtx,
    data: {
      enterpriseId: string;
      groupId: string;
      eventType: string;
      actorType: "user" | "system" | "scim" | "api_key" | "webhook";
      actorId?: string;
      subjectType: string;
      subjectId?: string;
      ok: boolean;
      requestId?: string;
      ip?: string;
      metadata?: Record<string, unknown>;
    },
  ) => {
    const { ok, ...rest } = data;
    return (await ctx.runMutation(
      config.component.public.enterpriseAuditEventCreate,
      {
        ...rest,
        status: ok ? "success" : "failure",
        occurredAt: Date.now(),
      },
    )) as string;
  };

  const emitEnterpriseWebhookDeliveries = async (
    ctx: ComponentCtx,
    data: {
      enterpriseId: string;
      eventType: string;
      payload: Record<string, unknown>;
      auditEventId?: string;
    },
  ) => {
    const endpoints = await ctx.runQuery(
      config.component.public.enterpriseWebhookEndpointList,
      { enterpriseId: data.enterpriseId },
    );
    for (const endpoint of endpoints) {
      if (
        endpoint.status !== "active" ||
        !endpoint.subscriptions.includes(data.eventType)
      ) {
        continue;
      }
      await ctx.runMutation(
        config.component.public.enterpriseWebhookDeliveryEnqueue,
        {
          enterpriseId: data.enterpriseId,
          endpointId: endpoint._id,
          auditEventId: data.auditEventId,
          eventType: data.eventType,
          payload: data.payload,
          nextAttemptAt: Date.now(),
        },
      );
    }
  };

  const getEnterpriseScimContext = async (
    ctx: ComponentReadCtx,
    request: Request,
  ) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthError("MISSING_BEARER_TOKEN").toConvexError();
    }
    const token = authHeader.slice(7);
    const scimConfig = await ctx.runQuery(
      config.component.public.enterpriseScimConfigGetByTokenHash,
      { tokenHash: await sha256(token) },
    );
    if (!scimConfig || scimConfig.status !== "active") {
      throw new AuthError(
        "INVALID_API_KEY",
        "Invalid SCIM token.",
      ).toConvexError();
    }
    const parsedPath = parseScimPath(new URL(request.url).pathname);
    if (parsedPath.enterpriseId !== scimConfig.enterpriseId) {
      throw new AuthError(
        "INVALID_API_KEY",
        "SCIM token/tenant mismatch.",
      ).toConvexError();
    }
    const enterprise = await ctx.runQuery(
      config.component.public.enterpriseGet,
      {
        enterpriseId: scimConfig.enterpriseId,
      },
    );
    if (enterprise === null) {
      throw new AuthError(
        "INVALID_PARAMETERS",
        "Enterprise not found.",
      ).toConvexError();
    }
    return { scimConfig, enterprise, parsedPath };
  };

  type ScimState = {
    ctx: ComponentCtx;
    request: Request;
    url: URL;
    parsedPath: ReturnType<typeof parseScimPath>;
    enterprise: Awaited<
      ReturnType<typeof getEnterpriseScimContext>
    >["enterprise"];
    scimConfig: Awaited<
      ReturnType<typeof getEnterpriseScimContext>
    >["scimConfig"];
    recordScimEvent: (
      eventType: string,
      ok: boolean,
      subjectType: string,
      subjectId?: string,
      metadata?: Record<string, unknown>,
    ) => Promise<void>;
  };

  type ScimHandler = (state: ScimState) => Promise<Response>;

  const SCIM_SCHEMAS = [
    {
      id: SCIM_USER_SCHEMA_ID,
      name: "User",
      description: "User Account",
      attributes: [
        { name: "userName", type: "string", required: true },
        { name: "displayName", type: "string" },
        { name: "active", type: "boolean" },
        { name: "emails", type: "complex", multiValued: true },
      ],
    },
    {
      id: SCIM_GROUP_SCHEMA_ID,
      name: "Group",
      description: "Group",
      attributes: [
        { name: "displayName", type: "string", required: true },
        { name: "members", type: "complex", multiValued: true },
      ],
    },
  ] as const;

  const SCIM_RESOURCE_TYPES = [
    {
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCIM_USER_SCHEMA_ID,
    },
    {
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: SCIM_GROUP_SCHEMA_ID,
    },
  ] as const;

  const handleStaticScimCollection = <T extends { id?: string; name?: string }>(
    items: readonly T[],
    resourceId: string | undefined,
    opts: { by: "id" | "name"; notFound: string },
  ) => {
    if (resourceId !== undefined) {
      const item = items.find(
        (entry) => entry[opts.by] === decodeURIComponent(resourceId),
      );
      return item ? scimJson(item) : scimError(404, "notFound", opts.notFound);
    }
    return scimJson({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      Resources: items,
      totalResults: items.length,
      startIndex: 1,
      itemsPerPage: items.length,
    });
  };

  const filterScimCollection = <T>(
    items: T[],
    filter: ReturnType<typeof parseScimListRequest>["filter"],
    filters: Record<string, (item: T, value: string) => boolean>,
  ) => {
    if (!filter) {
      return items;
    }
    const predicate = filters[filter.attribute];
    if (!predicate) {
      throw new Error("Unsupported SCIM filter.");
    }
    return items.filter((item) => predicate(item, filter.value));
  };

  const paginateScimCollection = <T>(
    items: T[],
    listRequest: ReturnType<typeof parseScimListRequest>,
  ) => {
    const start = listRequest.startIndex - 1;
    return items.slice(start, start + listRequest.count);
  };

  const requireScimResourceId = (
    resourceId: string | undefined,
    label: string,
  ) => {
    if (!resourceId) {
      return scimError(400, "invalidPath", `${label} resource ID is required.`);
    }
    return null;
  };

  const readScimJson = async (request: Request) =>
    (await request.json()) as Record<string, any>;

  const auth = {
    user: {
      /**
       * Get the current user's ID, or `null` if not signed in.
       *
       * Tries session JWT first. If `request` is provided, falls back to
       * verifying an `Authorization: Bearer sk_...` API key header.
       *
       * @param ctx - Any Convex context with an `auth` field.
       * @param request - Optional `Request`; enables API key fallback.
       * @returns The user's ID string, or `null` when unauthenticated.
       */
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
              const result = await auth.key.verify(ctx as ComponentCtx, rawKey);
              return result.userId;
            } catch {
              return null;
            }
          }
        }
        return null;
      },
      /**
       * Get the current user's ID, or throw `NOT_SIGNED_IN` if not signed in.
       *
       * Tries session JWT first. If `request` is provided, falls back to
       * verifying an `Authorization: Bearer sk_...` API key header.
       *
       * @param ctx - Any Convex context with an `auth` field.
       * @param request - Optional `Request`; enables API key fallback.
       * @returns The user's ID string.
       * @throws `ConvexError` with code `NOT_SIGNED_IN` when unauthenticated.
       */
      require: async (
        ctx: { auth: Auth } & Partial<ComponentCtx>,
        request?: Request,
      ): Promise<string> => {
        const userId = await auth.user.current(ctx, request);
        if (userId === null) {
          throw new AuthError("NOT_SIGNED_IN").toConvexError();
        }
        return userId;
      },
      /**
       * Retrieve a user document by their ID.
       *
       * @param ctx - Convex context with `runQuery`.
       * @param userId - The user document ID.
       * @returns The user document, or `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, userId: string) => {
        return await ctx.runQuery(config.component.public.userGetById, {
          userId,
        });
      },
      /**
       * List users with optional filters, sorting, and pagination.
       *
       * @param opts.where - Optional filters (email, phone, name, anonymous).
       * @param opts.limit - Max users to return (default 50).
       * @param opts.cursor - Pagination cursor from a previous page.
       * @param opts.orderBy - Sort field.
       * @param opts.order - Sort direction.
       * @returns `{ items, nextCursor }`.
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
        return await ctx.runQuery(config.component.public.userGetById, {
          userId,
        });
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
       * Set or clear a user's active group in `user.extend.lastActiveGroup`.
       *
       * This helper preserves other keys under `user.extend`.
       * Pass `groupId: null` to clear `lastActiveGroup`.
       */
      setActiveGroup: async (
        ctx: ComponentCtx,
        opts: { userId: string; groupId: string | null },
      ) => {
        const user = await auth.user.get(ctx, opts.userId);
        const existingExtend =
          user !== null &&
          user.extend !== null &&
          typeof user.extend === "object" &&
          !Array.isArray(user.extend)
            ? { ...(user.extend as Record<string, unknown>) }
            : {};

        if (opts.groupId === null) {
          const { lastActiveGroup: _omit, ...rest } = existingExtend;
          await auth.user.patch(ctx, opts.userId, { extend: rest });
          return;
        }

        await auth.user.patch(ctx, opts.userId, {
          extend: { ...existingExtend, lastActiveGroup: opts.groupId },
        });
      },
      /**
       * Get the user's active group ID from `user.extend.lastActiveGroup`.
       *
       * @param ctx - Convex context with `runQuery`.
       * @param opts.userId - The user document ID.
       * @returns The active group ID, or `null` if none is set.
       */
      getActiveGroup: async (
        ctx: ComponentReadCtx,
        opts: { userId: string },
      ): Promise<string | null> => {
        const user = await auth.user.get(ctx, opts.userId);
        if (
          user !== null &&
          user.extend !== null &&
          typeof user.extend === "object" &&
          !Array.isArray(user.extend)
        ) {
          const val = (user.extend as Record<string, unknown>).lastActiveGroup;
          if (typeof val === "string") {
            return val;
          }
        }
        return null;
      },

      /**
       * Delete a user and optionally cascade-delete all linked records.
       *
       * When `cascade` is `true` (default), this removes all sessions,
       * accounts, API keys, group memberships, passkeys, and TOTP
       * enrollments before deleting the user document itself.
       *
       * When `cascade` is `false`, the method throws if the user has any
       * linked records — the caller must clean them up explicitly first.
       *
       * @param ctx - Convex action context with `runMutation` and `runQuery`.
       * @param userId - The user document ID to delete.
       * @param opts.cascade - Whether to cascade-delete linked records (default: `true`).
       */
      remove: async (
        ctx: ComponentCtx,
        userId: string,
        opts?: { cascade?: boolean },
      ): Promise<void> => {
        const cascade = opts?.cascade !== false;

        // Collect all linked records
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
            `Cannot delete user with ${totalLinked} linked records. ` +
              `Pass { cascade: true } to delete all linked records, or ` +
              `remove them manually first.`,
          ).toConvexError();
        }

        // Cascade delete all linked records
        const deletions: Promise<unknown>[] = [];
        for (const s of sessions) {
          deletions.push(
            ctx.runMutation(config.component.public.sessionDelete, {
              sessionId: s._id,
            }),
          );
        }
        for (const a of accounts) {
          deletions.push(
            ctx.runMutation(config.component.public.accountDelete, {
              accountId: a._id,
            }),
          );
        }
        for (const k of keys) {
          deletions.push(
            ctx.runMutation(config.component.public.keyDelete, {
              keyId: k._id,
            }),
          );
        }
        for (const m of members) {
          deletions.push(
            ctx.runMutation(config.component.public.memberRemove, {
              memberId: m._id,
            }),
          );
        }
        for (const p of passkeys) {
          deletions.push(
            ctx.runMutation(config.component.public.passkeyDelete, {
              passkeyId: p._id,
            }),
          );
        }
        for (const t of totps) {
          deletions.push(
            ctx.runMutation(config.component.public.totpDelete, {
              totpId: t._id,
            }),
          );
        }
        await Promise.all(deletions);

        // Delete the user document
        await ctx.runMutation(config.component.public.userDelete, { userId });
      },
    },
    session: {
      /**
       * Get the current session ID from the auth context, or `null` if
       * not signed in.
       *
       * @param ctx - Any Convex context with an `auth` field.
       * @returns The session's `Id<"Session">`, or `null` when unauthenticated.
       */
      current: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          return null;
        }
        const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return sessionId as GenericId<"Session">;
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
          userId: GenericId<"User">;
          except?: GenericId<"Session">[];
        },
      ): Promise<void> => {
        return await callInvalidateSessions(ctx, args);
      },
      /**
       * Get a session by its document ID.
       *
       * @param ctx - Convex context with `runQuery`.
       * @param sessionId - The session document ID.
       * @returns The session document, or `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, sessionId: string) => {
        return await ctx.runQuery(config.component.public.sessionGetById, {
          sessionId,
        });
      },
      /**
       * List all active sessions for a user.
       *
       * @param ctx - Convex context with `runQuery`.
       * @param opts.userId - The user whose sessions to list.
       * @returns Array of session documents.
       */
      list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
        return await ctx.runQuery(config.component.public.sessionListByUser, {
          userId: opts.userId,
        });
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
        return await callCreateAccountFromCredentials(ctx, args);
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
        const result = await callRetrieveAccountWithCredentials(ctx, args);
        if (typeof result === "string") {
          throw new AuthError("ACCOUNT_NOT_FOUND", result).toConvexError();
        }
        return result;
      },
      /**
       * Update account credentials (secret) for an existing account.
       *
       * @param ctx - Convex action context.
       * @param args - Provider ID and new account credentials (id + secret).
       */
      update: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: UpdateAccountCredentialsArgs,
      ): Promise<void> => {
        return await callModifyAccount(ctx, args);
      },

      /**
       * Unlink (delete) an account from a user.
       *
       * Throws if the account is the user's only account and the user has
       * no other way to sign in (prevents locking the user out).
       *
       * @param ctx - Convex context with `runQuery` and `runMutation`.
       * @param accountId - The account document ID to unlink.
       */
      remove: async (ctx: ComponentCtx, accountId: string): Promise<void> => {
        // Look up the account to get the userId
        const account = await ctx.runQuery(
          config.component.public.accountGetById,
          { accountId },
        );
        if (account === null) {
          throw new AuthError(
            "ACCOUNT_NOT_FOUND",
            "Account not found.",
          ).toConvexError();
        }
        // Check if this is the user's only account
        const allAccounts = (await ctx.runQuery(
          config.component.public.accountListByUser,
          { userId: (account as any).userId },
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

      // --- Passkey account methods ---

      /** List all passkeys for a user. */
      listPasskeys: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
        return await ctx.runQuery(
          config.component.public.passkeyListByUserId,
          opts,
        );
      },
      /** Rename a passkey (set a user-friendly display name). */
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
      /** Delete a passkey credential. */
      removePasskey: async (ctx: ComponentCtx, passkeyId: string) => {
        await ctx.runMutation(config.component.public.passkeyDelete, {
          passkeyId,
        });
      },

      // --- TOTP account methods ---

      /** List all TOTP enrollments for a user. */
      listTotps: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
        return await ctx.runQuery(
          config.component.public.totpListByUserId,
          opts,
        );
      },
      /** Delete a TOTP enrollment. */
      removeTotp: async (ctx: ComponentCtx, totpId: string) => {
        await ctx.runMutation(config.component.public.totpDelete, { totpId });
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
          accountId?: GenericId<"Account">;
          params?: Record<string, unknown>;
        },
      ) => {
        const result = await signInImpl(
          enrichCtx(ctx),
          materializeProvider(provider),
          // params type widened: Record<string, unknown> → Record<string, any>
          args as {
            accountId?: GenericId<"Account">;
            params?: Record<string, any>;
          },
          {
            generateTokens: false,
            allowExtraProviders: true,
          },
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
          tags?: Array<{ key: string; value: string }>;
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
        return await ctx.runQuery(config.component.public.groupGet, {
          groupId,
        });
      },
      /**
       * List groups with optional filtering, sorting, and pagination.
       *
       * Empty `where` returns **all** groups.
       *
       * ```ts
       * // All groups of type "team"
       * await auth.group.list(ctx, { where: { type: "team" } });
       *
       * // Paginated
       * const page1 = await auth.group.list(ctx, { limit: 10 });
       * const page2 = await auth.group.list(ctx, { limit: 10, cursor: page1.nextCursor });
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
       * Update a group's fields (name, slug, tags, extend, parentGroupId).
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
       * Retrieve the ancestor chain for a group by walking `parentGroupId`
       * upward toward the root.
       *
       * Useful for breadcrumbs, permission inheritance visualization, and
       * operations that need the full hierarchy path.
       *
       * @param ctx - Convex context with `runQuery`.
       * @param opts.groupId - The starting group.
       * @param opts.maxDepth - Maximum traversal depth (default 32).
       * @param opts.includeSelf - Include the starting group as the first
       *   element (default `false`).
       * @returns Ancestors ordered from immediate parent to root, plus
       *   diagnostic flags.
       */
      ancestors: async (
        ctx: ComponentReadCtx,
        opts: {
          groupId: string;
          maxDepth?: number;
          includeSelf?: boolean;
        },
      ) => {
        const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? 32));
        const visited = new Set<string>();
        const ancestors: NonNullable<
          Awaited<ReturnType<typeof auth.group.get>>
        >[] = [];
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

          const group = await auth.group.get(ctx, currentGroupId);
          if (group === null) {
            break;
          }

          if (isFirst) {
            isFirst = false;
            if (opts.includeSelf) {
              ancestors.push(group);
            }
            currentGroupId = group.parentGroupId;
            depth += 1;
            continue;
          }

          ancestors.push(group);
          currentGroupId = group.parentGroupId;
          depth += 1;
        }

        return { ancestors, cycleDetected, maxDepthReached };
      },
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
        return await ctx.runQuery(config.component.public.memberGet, {
          memberId,
        });
      },
      /**
       * Look up a user's membership in a specific group.
       */
      getByUserAndGroup: async (
        ctx: ComponentReadCtx,
        opts: { userId: string; groupId: string },
      ) => {
        return await ctx.runQuery(
          config.component.public.memberGetByGroupAndUser,
          opts,
        );
      },
      /**
       * List members with optional filtering, sorting, and pagination.
       *
       * ```ts
       * // All members of a group
       * await auth.member.list(ctx, { where: { groupId } });
       *
       * // Admins only
       * await auth.member.list(ctx, { where: { groupId, role: "admin" } });
       * ```
       */
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
      /**
       * Remove a member from a group by deleting the member record.
       */
      remove: async (ctx: ComponentCtx, memberId: string) => {
        await ctx.runMutation(config.component.public.memberRemove, {
          memberId,
        });
      },
      /**
       * Update a member's fields (role, status, extend).
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
      /**
       * Resolve membership for a group, including inherited membership
       * from ancestor groups (`parentGroupId` chain).
       *
       * Returns direct membership when found on `opts.groupId`, otherwise
       * returns the nearest ancestor membership. Use `roles` to only match
       * specific roles (for example `admin`/`lead`).
       */
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

          const membership = await auth.member.getByUserAndGroup(ctx, {
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

          const group = await auth.group.get(ctx, currentGroupId);
          if (group === null || group.parentGroupId === undefined) {
            break;
          }

          currentGroupId = group.parentGroupId;
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
      /**
       * Require membership on a group, checking inherited membership
       * from ancestor groups when no direct membership exists.
       *
       * Throws `FORBIDDEN` if no matching membership is found.
       */
      require: async (
        ctx: ComponentReadCtx,
        opts: {
          userId: string;
          groupId: string;
          roles?: string[];
          maxDepth?: number;
        },
      ) => {
        const result = await auth.member.inherit(ctx, opts);
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
       * @param data.role - Optional role to assign on acceptance.
       * @param data.expiresTime - Optional expiration timestamp (omit for
       *   single-use, non-expiring invites).
       * @param data.extend - Optional arbitrary JSON extension data.
       * @throws ConvexError with code `DUPLICATE_INVITE` if a pending invite
       * already exists for this email and scope.
       * @returns An object with `inviteId` and raw `token`.
       */
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
          INVITE_TOKEN_LENGTH,
          INVITE_TOKEN_ALPHABET,
        );
        const tokenHash = await sha256(token);
        const inviteId = (await ctx.runMutation(
          config.component.public.inviteCreate,
          {
            ...data,
            tokenHash,
            status: "pending",
          },
        )) as string;
        return { inviteId, token };
      },
      /**
       * Retrieve an invite by its ID. Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, inviteId: string) => {
        return await ctx.runQuery(config.component.public.inviteGet, {
          inviteId,
        });
      },
      /**
       * Token-based invite helpers.
       */
      token: {
        /**
         * Retrieve an invite by raw token.
         */
        get: async (ctx: ComponentReadCtx, token: string) => {
          const tokenHash = await sha256(token);
          return await ctx.runQuery(
            config.component.public.inviteGetByTokenHash,
            {
              tokenHash,
            },
          );
        },
        /**
         * Accept an invitation by raw token and atomically add group membership
         * when the invite is group-scoped.
         */
        accept: async (
          ctx: ComponentCtx,
          args: { token: string; acceptedByUserId: string },
        ) => {
          const tokenHash = await sha256(args.token);
          return await ctx.runMutation(
            config.component.public.inviteAcceptByToken,
            {
              tokenHash,
              acceptedByUserId: args.acceptedByUserId,
            },
          );
        },
      },
      /**
       * List invites with optional filtering, sorting, and pagination.
       *
       * ```ts
       * // Pending invites for a group
       * await auth.invite.list(ctx, { where: { groupId, status: "pending" } });
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
      /**
       * Accept an invitation. Marks the invite as "accepted" and records
       * the timestamp. If the invite has a group, the caller is responsible
       * for creating the member record via `auth.member.add` in the
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
       *       await auth.member.add(ctx, {
       *         groupId: invite.groupId,
       *         userId,
       *         role: invite.role,
       *       });
       *     }
       *   },
       * });
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
        await ctx.runMutation(config.component.public.inviteRevoke, {
          inviteId,
        });
      },
    },
    /**
     * Manage passkey credentials for users.
     *
     * ```ts
     * const passkeys = await auth.passkey.list(ctx, { userId });
     * await auth.passkey.rename(ctx, passkeyId, "MacBook Touch ID");
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
     *   scopes: [{ resource: "data", actions: ["read"] }],
     * });
     * // raw = "sk_abc123..." — show once, never stored
     *
     * const result = await auth.key.verify(ctx, rawKey);
     * result.scopes.can("data", "read"); // true
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
       * @param opts.metadata - Optional arbitrary app data attached to the key.
       * @returns `{ keyId, raw }` where `raw` is the full key string.
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
      ): Promise<{ keyId: string; raw: string }> => {
        const { raw, hashedKey, displayPrefix } = await generateApiKey("sk_");

        const keyId = (await ctx.runMutation(
          config.component.public.keyInsert,
          {
            userId: opts.userId,
            prefix: displayPrefix,
            hashedKey,
            name: opts.name,
            scopes: opts.scopes,
            rateLimit: opts.rateLimit,
            expiresAt: opts.expiresAt,
            metadata: opts.metadata,
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
        scopes: ScopeChecker;
      }> => {
        const hashedKey = await hashApiKey(rawKey);

        const key = (await ctx.runQuery(
          config.component.public.keyGetByHashedKey,
          { hashedKey },
        )) as KeyDoc | null;

        return Fx.run(
          Fx.gen(function* () {
            yield* Fx.guard(!key, Fx.fail(new AuthError("INVALID_API_KEY")));
            const k = key!;

            yield* Fx.guard(
              k.revoked,
              Fx.fail(new AuthError("API_KEY_REVOKED")),
            );

            yield* Fx.guard(
              !!(k.expiresAt && k.expiresAt < Date.now()),
              Fx.fail(new AuthError("API_KEY_EXPIRED")),
            );

            // Check per-key rate limit
            const patchData: Record<string, unknown> = {
              lastUsedAt: Date.now(),
            };

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

            // Update lastUsedAt (and rate limit state if applicable)
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

      /**
       * List API keys with optional filtering, sorting, and pagination.
       * Never includes the raw key — only the display prefix.
       *
       * ```ts
       * // All keys for a user
       * await auth.key.list(ctx, { where: { userId } });
       *
       * // Only active (non-revoked)
       * await auth.key.list(ctx, { where: { userId, revoked: false } });
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
       * Get a single API key by its document ID.
       * Returns `null` if not found.
       */
      get: async (
        ctx: ComponentReadCtx,
        keyId: string,
      ): Promise<KeyDoc | null> => {
        return (await ctx.runQuery(config.component.public.keyGetById, {
          keyId,
        })) as KeyDoc | null;
      },

      /**
       * Update an API key's metadata (name, scopes, rate limit).
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

      /**
       * Rotate an API key — revoke the old key and issue a replacement with
       * the same `userId`, `name`, `scopes`, and `rateLimit`.
       *
       * The old key is soft-revoked immediately; the replacement is a brand
       * new key with a new raw value. Returns the new `keyId` and `raw` key
       * (shown once, same as `auth.key.create`).
       *
       * @throws If the key does not exist or is already revoked.
       *
       * @example
       * ```ts
       * const { keyId, raw } = await auth.key.rotate(ctx, oldKeyId);
       * // raw = "sk_abc..." — new key to hand to the caller
       * // old key is now revoked and verify() will throw API_KEY_REVOKED
       * ```
       */
      rotate: async (
        ctx: ComponentCtx,
        keyId: string,
        opts?: { name?: string; expiresAt?: number },
      ): Promise<{ keyId: string; raw: string }> => {
        const existing = await ctx.runQuery(
          config.component.public.keyGetById,
          { keyId },
        );
        if (!existing) {
          throw new AuthError(
            "INVALID_PARAMETERS",
            "API key not found.",
          ).toConvexError();
        }
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
        return await auth.key.create(ctx, {
          userId: (existing as any).userId,
          name: opts?.name ?? (existing as any).name,
          scopes: (existing as any).scopes ?? [],
          rateLimit: (existing as any).rateLimit,
          expiresAt: opts?.expiresAt,
          metadata: (existing as any).metadata,
        });
      },
    },
    /**
     * SSO namespace — enterprise SSO connection management, domain, OIDC,
     * SAML, SCIM, audit, and webhook helpers.
     */
    sso: {
      connection: {
        create: async (
          ctx: ComponentCtx,
          data: {
            groupId: string;
            slug?: string;
            name?: string;
            status?: "draft" | "active" | "disabled";
            config?: Record<string, unknown>;
            extend?: Record<string, unknown>;
          },
        ): Promise<string> => {
          return (await ctx.runMutation(
            config.component.public.enterpriseCreate,
            data,
          )) as string;
        },
        get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          return await ctx.runQuery(config.component.public.enterpriseGet, {
            enterpriseId,
          });
        },
        getByGroup: async (ctx: ComponentReadCtx, groupId: string) => {
          return await ctx.runQuery(
            config.component.public.enterpriseGetByGroup,
            {
              groupId,
            },
          );
        },
        getByDomain: async (ctx: ComponentReadCtx, domain: string) => {
          return await ctx.runQuery(
            config.component.public.enterpriseGetByDomain,
            {
              domain: normalizeDomain(domain),
            },
          );
        },
        list: async (
          ctx: ComponentReadCtx,
          opts?: {
            where?: {
              groupId?: string;
              slug?: string;
              status?: "draft" | "active" | "disabled";
            };
            limit?: number;
            cursor?: string | null;
            orderBy?: "_creationTime" | "name" | "slug" | "status";
            order?: "asc" | "desc";
          },
        ) => {
          return await ctx.runQuery(config.component.public.enterpriseList, {
            where: opts?.where,
            limit: opts?.limit,
            cursor: opts?.cursor,
            orderBy: opts?.orderBy,
            order: opts?.order,
          });
        },
        update: async (
          ctx: ComponentCtx,
          enterpriseId: string,
          data: Record<string, unknown>,
        ) => {
          await ctx.runMutation(config.component.public.enterpriseUpdate, {
            enterpriseId,
            data,
          });
        },
        remove: async (ctx: ComponentCtx, enterpriseId: string) => {
          await ctx.runMutation(config.component.public.enterpriseDelete, {
            enterpriseId,
          });
        },
        /**
         * Aggregate readiness status across all configured protocols for an
         * enterprise connection.
         *
         * Returns a structured result indicating whether the connection is
         * ready, with per-protocol checks so callers can surface actionable
         * diagnostics without running full network validation.
         */
        status: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            { enterpriseId },
          );
          if (!enterprise) {
            throw new AuthError(
              "INVALID_PARAMETERS",
              enterpriseNotFoundError,
            ).toConvexError();
          }
          const protocols = enterprise.config?.protocols ?? {};
          const oidcConfig = protocols.oidc;
          const samlConfig = protocols.saml;
          const scimConfig = await ctx.runQuery(
            config.component.public.enterpriseScimConfigGetByEnterprise,
            { enterpriseId },
          );
          const domains = await ctx.runQuery(
            config.component.public.enterpriseDomainList,
            { enterpriseId },
          );

          const oidcReady =
            oidcConfig?.enabled === true &&
            typeof oidcConfig?.clientId === "string" &&
            oidcConfig.clientId.length > 0 &&
            (typeof oidcConfig?.issuer === "string" ||
              typeof oidcConfig?.discoveryUrl === "string");
          const samlReady =
            samlConfig?.enabled === true &&
            typeof samlConfig?.idp?.entityId === "string";
          const scimReady =
            scimConfig !== null &&
            scimConfig !== undefined &&
            (scimConfig as any).status === "active";

          const ready =
            enterprise.status === "active" && (oidcReady || samlReady);

          return {
            enterpriseId: enterprise._id,
            status: enterprise.status,
            ready,
            domainCount: (domains as unknown[]).length,
            protocols: {
              oidc: {
                configured: oidcReady,
                ready: oidcReady,
                clientId: oidcConfig?.clientId ?? null,
                issuer: oidcConfig?.issuer ?? oidcConfig?.discoveryUrl ?? null,
              },
              saml: {
                configured: samlReady,
                ready: samlReady,
                entityId: samlConfig?.idp?.entityId ?? null,
              },
              scim: {
                configured: scimReady,
                ready: scimReady,
                basePath: scimConfig?.basePath ?? null,
                deprovisionMode: scimConfig?.deprovisionMode ?? null,
              },
            },
          };
        },
      },
      domain: {
        add: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            groupId: string;
            domain: string;
            isPrimary?: boolean;
            verifiedAt?: number;
          },
        ): Promise<string> => {
          return (await ctx.runMutation(
            config.component.public.enterpriseDomainAdd,
            {
              ...data,
              domain: normalizeDomain(data.domain),
            },
          )) as string;
        },
        list: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          return await ctx.runQuery(
            config.component.public.enterpriseDomainList,
            {
              enterpriseId,
            },
          );
        },
        remove: async (ctx: ComponentCtx, domainId: string) => {
          await ctx.runMutation(
            config.component.public.enterpriseDomainDelete,
            {
              domainId,
            },
          );
        },
      },
      saml: {
        configure: async <DataModel extends GenericDataModel>(
          ctx: GenericActionCtx<DataModel>,
          data: {
            enterpriseId: string;
            metadataXml?: string;
            metadataUrl?: string;
            domains?: string[];
            signAuthnRequests?: boolean;
            attributeMapping?: {
              subject?: string;
              email?: string;
              name?: string;
              firstName?: string;
              lastName?: string;
            };
            sp?: {
              entityId?: string;
              acsUrl?: string;
              sloUrl?: string;
              signingCert?: string | string[];
              encryptCert?: string | string[];
              privateKey?: string;
              privateKeyPass?: string;
              encPrivateKey?: string;
              encPrivateKeyPass?: string;
            };
          },
        ) => {
          return await Fx.run(
            Fx.gen(function* () {
              const enterprise = yield* Fx.from({
                ok: () =>
                  ctx.runQuery(config.component.public.enterpriseGet, {
                    enterpriseId: data.enterpriseId,
                  }),
                err: () =>
                  new AuthError("INTERNAL_ERROR", "Failed to load enterprise."),
              }).pipe(
                Fx.chain((ent) =>
                  ent === null
                    ? Fx.fail(
                        new AuthError(
                          "INVALID_PARAMETERS",
                          enterpriseNotFoundError,
                        ),
                      )
                    : Fx.succeed(ent),
                ),
              );
              const metadataXml = yield* data.metadataXml
                ? Fx.succeed(data.metadataXml)
                : data.metadataUrl
                  ? Fx.defer(() =>
                      Fx.from({
                        ok: async () => {
                          const response = await fetch(data.metadataUrl!);
                          if (!response.ok) {
                            throw new Error(
                              `Failed to fetch SAML metadata: ${response.status}`,
                            );
                          }
                          return await response.text();
                        },
                        err: (error) =>
                          new AuthError(
                            "INVALID_PARAMETERS",
                            error instanceof Error
                              ? error.message
                              : "Failed to fetch SAML metadata",
                          ),
                      }),
                    ).pipe(
                      Fx.timeout(10_000),
                      Fx.retry(
                        Fx.retry.compose(
                          Fx.retry.jittered(Fx.retry.exponential(200)),
                          Fx.retry.recurs(2),
                        ),
                      ),
                      Fx.recover((error) =>
                        Fx.fail(
                          new AuthError(
                            "INVALID_PARAMETERS",
                            error instanceof Error
                              ? error.message
                              : "Failed to fetch SAML metadata",
                          ),
                        ),
                      ),
                    )
                  : Fx.fail(
                      new AuthError(
                        "INVALID_PARAMETERS",
                        "SAML registration requires metadataXml or metadataUrl.",
                      ),
                    );

              const parsed = yield* Fx.from({
                ok: () => parseSamlIdpMetadata(metadataXml),
                err: () =>
                  new AuthError(
                    "INVALID_PARAMETERS",
                    "Failed to parse SAML metadata.",
                  ),
              });

              const baseConfig = upsertProtocolConfig(
                enterprise.config,
                "saml",
                {
                  enabled: true,
                  idp: {
                    metadataXml,
                    ...parsed,
                  },
                  sp: data.sp,
                  signAuthnRequests:
                    data.signAuthnRequests ?? parsed.wantsSignedAuthnRequests,
                  attributeMapping: data.attributeMapping,
                  accountLinking: "verifiedEmail",
                  reuseScimUserBy: "externalId",
                },
              );
              const normalizedDomains = data.domains?.map(normalizeDomain);
              const nextConfig = normalizedDomains
                ? { ...baseConfig, domains: normalizedDomains }
                : baseConfig;

              yield* Fx.from({
                ok: () =>
                  ctx.runMutation(config.component.public.enterpriseUpdate, {
                    enterpriseId: enterprise._id,
                    data: {
                      status: "active",
                      config: nextConfig,
                    },
                  }),
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to persist SAML registration.",
                  ),
              });

              if (normalizedDomains) {
                for (const [index, domain] of normalizedDomains.entries()) {
                  yield* Fx.from({
                    ok: () =>
                      ctx.runMutation(
                        config.component.public.enterpriseDomainAdd,
                        {
                          enterpriseId: enterprise._id,
                          groupId: enterprise.groupId,
                          domain,
                          isPrimary: index === 0,
                        },
                      ),
                    err: () =>
                      new AuthError(
                        "INTERNAL_ERROR",
                        "Failed to persist enterprise domain.",
                      ),
                  });
                }
              }

              yield* Fx.from({
                ok: () =>
                  recordEnterpriseAuditEvent(ctx, {
                    enterpriseId: enterprise._id,
                    groupId: enterprise.groupId,
                    eventType: "enterprise.saml.registered",
                    actorType: "system",
                    subjectType: "enterprise_saml",
                    subjectId: enterprise._id,
                    ok: true,
                    metadata: {
                      metadataUrl: data.metadataUrl,
                      domains: normalizedDomains,
                    },
                  }),
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to record SAML registration audit event.",
                  ),
              });

              return {
                enterpriseId: enterprise._id,
                groupId: enterprise.groupId,
              };
            }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
          );
        },
        metadata: async <DataModel extends GenericDataModel>(
          ctx: GenericActionCtx<DataModel>,
          opts: {
            enterpriseId: string;
            entityId?: string;
            acsUrl?: string;
            sloUrl?: string;
          },
        ) => {
          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            {
              enterpriseId: opts.enterpriseId,
            },
          );
          if (!enterprise) {
            throw new AuthError(
              "INVALID_PARAMETERS",
              "Enterprise not found.",
            ).toConvexError();
          }

          return createServiceProviderMetadata(
            getSamlServiceProviderOptions({
              rootUrl: requireEnv("CONVEX_SITE_URL"),
              source: { kind: "enterprise", id: enterprise._id },
              config: enterprise.config,
              overrides: {
                entityId: opts.entityId,
                acsUrl: opts.acsUrl,
                sloUrl: opts.sloUrl,
              },
            }),
          );
        },
        /**
         * Validate the stored SAML config for an enterprise connection.
         *
         * Re-parses IdP metadata, checks signing cert presence, and verifies
         * SP metadata can be generated. Returns a structured result with
         * per-check details rather than throwing on first failure.
         */
        validate: async <DataModel extends GenericDataModel>(
          ctx: GenericActionCtx<DataModel>,
          enterpriseId: string,
        ) => {
          const checks: Array<{
            name: string;
            ok: boolean;
            message?: string;
          }> = [];

          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            { enterpriseId },
          );

          if (!enterprise) {
            return {
              ok: false,
              enterpriseId,
              checks: [
                {
                  name: "enterprise_exists",
                  ok: false,
                  message: "Enterprise not found.",
                },
              ],
            };
          }

          const samlConfig = enterprise.config?.protocols?.saml;
          const samlConfigured =
            samlConfig?.enabled === true &&
            typeof samlConfig?.idp?.metadataXml === "string";

          checks.push({
            name: "saml_configured",
            ok: samlConfigured,
            message: samlConfigured ? undefined : "SAML is not configured.",
          });

          const hasIdpMetadata =
            typeof samlConfig?.idp?.metadataXml === "string" &&
            samlConfig.idp.metadataXml.length > 0;
          checks.push({
            name: "idp_metadata_present",
            ok: hasIdpMetadata,
            message: hasIdpMetadata
              ? undefined
              : "IdP metadata XML is missing.",
          });

          const hasEntityId =
            typeof samlConfig?.idp?.entityId === "string" &&
            samlConfig.idp.entityId.length > 0;
          checks.push({
            name: "idp_entity_id",
            ok: hasEntityId,
            message: hasEntityId
              ? undefined
              : "IdP entityId could not be parsed from metadata.",
          });

          let spMetadataOk = false;
          let spMetadataMessage: string | undefined;
          if (samlConfigured) {
            try {
              createServiceProviderMetadata(
                getSamlServiceProviderOptions({
                  rootUrl: requireEnv("CONVEX_SITE_URL"),
                  source: { kind: "enterprise", id: enterprise._id },
                  config: enterprise.config,
                  overrides: {},
                }),
              );
              spMetadataOk = true;
            } catch (e) {
              spMetadataMessage =
                e instanceof Error
                  ? e.message
                  : "SP metadata generation failed.";
            }
          } else {
            spMetadataMessage = "Skipped — SAML not configured.";
          }
          checks.push({
            name: "sp_metadata_generates",
            ok: spMetadataOk,
            message: spMetadataMessage,
          });

          return {
            ok: checks.every((c) => c.ok),
            enterpriseId: enterprise._id,
            checks,
          };
        },
      },
      oidc: {
        /**
         * Register or update enterprise OIDC connection settings.
         *
         * Persists protocol config under `enterprise.config.protocols.oidc` and
         * records an `enterprise.oidc.registered` audit event.
         */
        configure: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            issuer?: string;
            discoveryUrl?: string;
            clientId: string;
            clientSecret?: string;
            scopes?: string[];
            authorizationParams?: Record<string, string>;
            clockToleranceSeconds?: number;
            strictIssuer?: boolean;
            /**
             * Map OIDC claim names to `user.extend` field names.
             * Example: `{ department: "department", role: "job_title" }` means
             * the OIDC `department` claim is stored as `user.extend.department`.
             */
            extraFields?: Record<string, string>;
          },
        ) => {
          return await Fx.run(
            Fx.gen(function* () {
              yield* Fx.guard(
                data.issuer === undefined && data.discoveryUrl === undefined,
                Fx.fail(
                  new AuthError(
                    "INVALID_PARAMETERS",
                    "OIDC registration requires issuer or discoveryUrl.",
                  ),
                ),
              );

              const enterprise = yield* Fx.from({
                ok: () =>
                  ctx.runQuery(config.component.public.enterpriseGet, {
                    enterpriseId: data.enterpriseId,
                  }),
                err: () =>
                  new AuthError("INTERNAL_ERROR", "Failed to load enterprise."),
              }).pipe(
                Fx.chain((ent) =>
                  ent === null
                    ? Fx.fail(
                        new AuthError(
                          "INVALID_PARAMETERS",
                          enterpriseNotFoundError,
                        ),
                      )
                    : Fx.succeed(ent),
                ),
              );
              const nextConfig = upsertProtocolConfig(
                enterprise.config,
                "oidc",
                {
                  enabled: true,
                  issuer: data.issuer,
                  discoveryUrl: data.discoveryUrl,
                  clientId: data.clientId,
                  clientSecret: data.clientSecret,
                  scopes: data.scopes ?? ["openid", "profile", "email"],
                  authorizationParams: data.authorizationParams,
                  accountLinking: "verifiedEmail",
                  reuseScimUserBy: "externalId",
                  clockToleranceSeconds: data.clockToleranceSeconds,
                  strictIssuer: data.strictIssuer,
                  extraFields: data.extraFields,
                },
              );

              yield* Fx.from({
                ok: () =>
                  ctx.runMutation(config.component.public.enterpriseUpdate, {
                    enterpriseId: data.enterpriseId,
                    data: { config: nextConfig },
                  }),
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to persist OIDC registration.",
                  ),
              });

              yield* Fx.from({
                ok: () =>
                  recordEnterpriseAuditEvent(ctx, {
                    enterpriseId: data.enterpriseId,
                    groupId: enterprise.groupId,
                    eventType: "enterprise.oidc.registered",
                    actorType: "system",
                    subjectType: "enterprise_oidc",
                    subjectId: data.enterpriseId,
                    ok: true,
                    metadata: {
                      issuer: data.issuer,
                      discoveryUrl: data.discoveryUrl,
                    },
                  }),
                err: () =>
                  new AuthError(
                    "INTERNAL_ERROR",
                    "Failed to record OIDC registration audit event.",
                  ),
              });

              return getOidcConfig(nextConfig);
            }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
          );
        },
        /**
         * Fetch the stored OIDC config for an enterprise.
         */
        get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          return await Fx.run(
            Fx.from({
              ok: () =>
                ctx.runQuery(config.component.public.enterpriseGet, {
                  enterpriseId,
                }),
              err: () =>
                new AuthError("INTERNAL_ERROR", "Failed to load enterprise."),
            }).pipe(
              Fx.chain((ent) =>
                ent === null
                  ? Fx.fail(
                      new AuthError(
                        "INVALID_PARAMETERS",
                        enterpriseNotFoundError,
                      ),
                    )
                  : Fx.succeed(ent),
              ),
              Fx.map((enterprise) => getOidcConfig(enterprise.config)),
              Fx.recover((e) => Fx.fatal(e.toConvexError())),
            ),
          );
        },
        /**
         * Resolve enterprise OIDC sign-in route from enterprise id, domain, or
         * user email domain.
         */
        resolveSignIn: async (
          ctx: ComponentReadCtx,
          data: {
            enterpriseId?: string;
            email?: string;
            domain?: string;
            redirectTo?: string;
          },
        ) => {
          return await Fx.run(
            Fx.gen(function* () {
              const enterprise =
                data.enterpriseId !== undefined
                  ? yield* Fx.from({
                      ok: () =>
                        ctx.runQuery(config.component.public.enterpriseGet, {
                          enterpriseId: data.enterpriseId,
                        }),
                      err: () =>
                        new AuthError(
                          "INTERNAL_ERROR",
                          "Failed to load enterprise.",
                        ),
                    }).pipe(
                      Fx.chain((ent) =>
                        ent === null
                          ? Fx.fail(
                              new AuthError(
                                "INVALID_PARAMETERS",
                                enterpriseNotFoundError,
                              ),
                            )
                          : Fx.succeed(ent),
                      ),
                    )
                  : data.domain !== undefined || data.email !== undefined
                    ? yield* Fx.from({
                        ok: () =>
                          ctx.runQuery(
                            config.component.public.enterpriseGetByDomain,
                            {
                              domain: normalizeDomain(
                                data.domain ??
                                  String(data.email).split("@").at(-1) ??
                                  "",
                              ),
                            },
                          ),
                        err: () =>
                          new AuthError(
                            "INTERNAL_ERROR",
                            "Failed to resolve enterprise by domain.",
                          ),
                      }).pipe(
                        Fx.chain((result) =>
                          result?.enterprise
                            ? Fx.succeed(result.enterprise)
                            : Fx.fail(
                                new AuthError(
                                  "INVALID_PARAMETERS",
                                  "No enterprise OIDC connection matched the provided input.",
                                ),
                              ),
                        ),
                      )
                    : yield* Fx.fail(
                        new AuthError(
                          "INVALID_PARAMETERS",
                          "No enterprise OIDC connection matched the provided input.",
                        ),
                      );

              yield* Fx.guard(
                enterprise.status !== "active",
                Fx.fail(
                  new AuthError(
                    "INVALID_PARAMETERS",
                    "Enterprise connection is not active.",
                  ),
                ),
              );

              const oidc = getOidcConfig(enterprise.config);
              yield* Fx.guard(
                oidc.enabled !== true,
                Fx.fail(
                  new AuthError(
                    "PROVIDER_NOT_CONFIGURED",
                    "OIDC is not configured for this enterprise.",
                  ),
                ),
              );

              const urls = getEnterpriseOidcUrls({
                rootUrl: requireEnv("CONVEX_SITE_URL"),
                enterpriseId: enterprise._id,
              });
              return {
                enterpriseId: enterprise._id,
                providerId: enterpriseOidcProviderId(enterprise._id),
                signInPath: urls.signInUrl,
                callbackPath: urls.callbackUrl,
                redirectTo: data.redirectTo,
              };
            }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
          );
        },
        /**
         * Validate the stored OIDC config for an enterprise connection.
         *
         * Fetches the OIDC discovery document from the configured issuer or
         * discoveryUrl, verifies required fields are present, and checks that
         * clientId is set. Returns a structured result with per-check details.
         */
        validate: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          const checks: Array<{
            name: string;
            ok: boolean;
            message?: string;
          }> = [];

          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            { enterpriseId },
          );

          if (!enterprise) {
            return {
              ok: false,
              enterpriseId,
              checks: [
                {
                  name: "enterprise_exists",
                  ok: false,
                  message: "Enterprise not found.",
                },
              ],
            };
          }

          const oidc = getOidcConfig(enterprise.config);
          const oidcConfigured =
            oidc.enabled === true &&
            typeof oidc.clientId === "string" &&
            oidc.clientId.length > 0;

          checks.push({
            name: "oidc_configured",
            ok: oidcConfigured,
            message: oidcConfigured ? undefined : "OIDC is not configured.",
          });

          const hasClientId =
            typeof oidc.clientId === "string" && oidc.clientId.length > 0;
          checks.push({
            name: "client_id_present",
            ok: hasClientId,
            message: hasClientId ? undefined : "clientId is missing.",
          });

          const discoveryTarget = oidc.discoveryUrl ?? oidc.issuer;
          const hasDiscovery =
            typeof discoveryTarget === "string" && discoveryTarget.length > 0;
          checks.push({
            name: "issuer_or_discovery_url_present",
            ok: hasDiscovery,
            message: hasDiscovery
              ? undefined
              : "issuer or discoveryUrl is missing.",
          });

          let discoveryOk = false;
          let discoveryMessage: string | undefined;
          if (hasDiscovery) {
            const discoveryUrl = oidc.discoveryUrl?.length
              ? oidc.discoveryUrl
              : `${oidc.issuer}/.well-known/openid-configuration`;
            try {
              const res = await fetch(discoveryUrl, {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(8_000),
              });
              if (!res.ok) {
                discoveryMessage = `Discovery endpoint returned ${res.status}.`;
              } else {
                const json = (await res.json()) as Record<string, unknown>;
                if (typeof json.issuer !== "string") {
                  discoveryMessage =
                    "Discovery document is missing issuer field.";
                } else if (typeof json.authorization_endpoint !== "string") {
                  discoveryMessage =
                    "Discovery document is missing authorization_endpoint.";
                } else {
                  discoveryOk = true;
                }
              }
            } catch (e) {
              discoveryMessage =
                e instanceof Error
                  ? `Discovery fetch failed: ${e.message}`
                  : "Discovery fetch failed.";
            }
          } else {
            discoveryMessage = "Skipped — issuer or discoveryUrl not set.";
          }
          checks.push({
            name: "discovery_reachable",
            ok: discoveryOk,
            message: discoveryMessage,
          });

          return {
            ok: checks.every((c) => c.ok),
            enterpriseId: enterprise._id,
            checks,
          };
        },
      },
      scim: {
        configure: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            basePath?: string;
            deprovisionMode?: "soft" | "hard";
            status?: "draft" | "active" | "disabled";
          },
        ) => {
          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            {
              enterpriseId: data.enterpriseId,
            },
          );
          if (enterprise === null) {
            throw new AuthError(
              "INVALID_PARAMETERS",
              "Enterprise not found.",
            ).toConvexError();
          }
          const rawToken = generateRandomString(48, INVITE_TOKEN_ALPHABET);
          const tokenHash = await sha256(rawToken);
          const configId = (await ctx.runMutation(
            config.component.public.enterpriseScimConfigUpsert,
            {
              enterpriseId: enterprise._id,
              groupId: enterprise.groupId,
              status: data.status ?? "active",
              basePath:
                data.basePath ??
                `${requireEnv("CONVEX_SITE_URL")}/api/auth/sso/${enterprise._id}/scim/v2`,
              tokenHash,
              lastRotatedAt: Date.now(),
              deprovisionMode: data.deprovisionMode ?? "soft",
            },
          )) as string;
          const auditEventId = await recordEnterpriseAuditEvent(ctx, {
            enterpriseId: enterprise._id,
            groupId: enterprise.groupId,
            eventType: "enterprise.scim.configured",
            actorType: "system",
            subjectType: "enterprise_scim",
            subjectId: configId,
            ok: true,
          });
          await emitEnterpriseWebhookDeliveries(ctx, {
            enterpriseId: enterprise._id,
            eventType: "enterprise.scim.configured",
            auditEventId,
            payload: { enterpriseId: enterprise._id, scimConfigId: configId },
          });
          return { token: rawToken, configId };
        },
        get: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          return await ctx.runQuery(
            config.component.public.enterpriseScimConfigGetByEnterprise,
            { enterpriseId },
          );
        },
        getConfigByToken: async (ctx: ComponentReadCtx, token: string) => {
          return await ctx.runQuery(
            config.component.public.enterpriseScimConfigGetByTokenHash,
            { tokenHash: await sha256(token) },
          );
        },
        /**
         * Validate the stored SCIM config for an enterprise connection.
         *
         * Checks that a SCIM config record exists, is active, has a token
         * hash set, and has a non-empty basePath. Returns a structured result
         * with per-check details.
         */
        validate: async (ctx: ComponentReadCtx, enterpriseId: string) => {
          const checks: Array<{
            name: string;
            ok: boolean;
            message?: string;
          }> = [];

          const enterprise = await ctx.runQuery(
            config.component.public.enterpriseGet,
            { enterpriseId },
          );

          if (!enterprise) {
            return {
              ok: false,
              enterpriseId,
              checks: [
                {
                  name: "enterprise_exists",
                  ok: false,
                  message: "Enterprise not found.",
                },
              ],
            };
          }

          const scimConfig = await ctx.runQuery(
            config.component.public.enterpriseScimConfigGetByEnterprise,
            { enterpriseId },
          );

          const hasConfig = scimConfig !== null && scimConfig !== undefined;
          checks.push({
            name: "scim_config_exists",
            ok: hasConfig,
            message: hasConfig ? undefined : "SCIM has not been configured.",
          });

          const isActive = hasConfig && (scimConfig as any).status === "active";
          checks.push({
            name: "scim_config_active",
            ok: isActive,
            message: isActive
              ? undefined
              : `SCIM config status is ${hasConfig ? (scimConfig as any).status : "unknown"}.`,
          });

          const hasToken =
            hasConfig &&
            typeof (scimConfig as any).tokenHash === "string" &&
            (scimConfig as any).tokenHash.length > 0;
          checks.push({
            name: "token_hash_set",
            ok: hasToken,
            message: hasToken
              ? undefined
              : "SCIM bearer token has not been set.",
          });

          const hasBasePath =
            hasConfig &&
            typeof (scimConfig as any).basePath === "string" &&
            (scimConfig as any).basePath.length > 0;
          checks.push({
            name: "base_path_set",
            ok: hasBasePath,
            message: hasBasePath ? undefined : "SCIM basePath is missing.",
          });

          return {
            ok: checks.every((c) => c.ok),
            enterpriseId: enterprise._id,
            basePath: hasBasePath ? (scimConfig as any).basePath : null,
            deprovisionMode: hasConfig
              ? (scimConfig as any).deprovisionMode
              : null,
            checks,
          };
        },
        identity: {
          get: async (
            ctx: ComponentReadCtx,
            data: {
              enterpriseId: string;
              resourceType: "user" | "group";
              externalId: string;
            },
          ) => {
            return await ctx.runQuery(
              config.component.public.enterpriseScimIdentityGet,
              data,
            );
          },
          upsert: async (
            ctx: ComponentCtx,
            data: {
              enterpriseId: string;
              groupId: string;
              resourceType: "user" | "group";
              externalId: string;
              userId?: string;
              mappedGroupId?: string;
              active?: boolean;
              raw?: Record<string, unknown>;
            },
          ) => {
            return (await ctx.runMutation(
              config.component.public.enterpriseScimIdentityUpsert,
              { ...data, lastProvisionedAt: Date.now() },
            )) as string;
          },
        },
      },
      audit: {
        record: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            groupId: string;
            eventType: string;
            actorType: "user" | "system" | "scim" | "api_key" | "webhook";
            actorId?: string;
            subjectType: string;
            subjectId?: string;
            ok: boolean;
            requestId?: string;
            ip?: string;
            metadata?: Record<string, unknown>;
          },
        ) => {
          return await recordEnterpriseAuditEvent(ctx, data);
        },
        list: async (
          ctx: ComponentReadCtx,
          data: { enterpriseId?: string; groupId?: string; limit?: number },
        ) => {
          return await ctx.runQuery(
            config.component.public.enterpriseAuditEventList,
            data,
          );
        },
      },
      webhook: {
        endpoint: {
          create: async (
            ctx: ComponentCtx,
            data: {
              enterpriseId: string;
              url: string;
              secret: string;
              subscriptions: string[];
              createdByUserId?: string;
            },
          ) => {
            const enterprise = await ctx.runQuery(
              config.component.public.enterpriseGet,
              {
                enterpriseId: data.enterpriseId,
              },
            );
            if (enterprise === null) {
              throw new AuthError(
                "INVALID_PARAMETERS",
                "Enterprise not found.",
              ).toConvexError();
            }
            const secretHash = await sha256(data.secret);
            const endpointId = (await ctx.runMutation(
              config.component.public.enterpriseWebhookEndpointCreate,
              {
                enterpriseId: enterprise._id,
                groupId: enterprise.groupId,
                url: data.url,
                secretHash,
                subscriptions: data.subscriptions,
                createdByUserId: data.createdByUserId,
              },
            )) as string;
            await recordEnterpriseAuditEvent(ctx, {
              enterpriseId: enterprise._id,
              groupId: enterprise.groupId,
              eventType: "enterprise.webhook.endpoint.created",
              actorType: data.createdByUserId ? "user" : "system",
              actorId: data.createdByUserId,
              subjectType: "enterprise_webhook_endpoint",
              subjectId: endpointId,
              ok: true,
            });
            return { endpointId };
          },
          list: async (ctx: ComponentReadCtx, enterpriseId: string) => {
            return await ctx.runQuery(
              config.component.public.enterpriseWebhookEndpointList,
              { enterpriseId },
            );
          },
          disable: async (ctx: ComponentCtx, endpointId: string) => {
            await ctx.runMutation(
              config.component.public.enterpriseWebhookEndpointUpdate,
              { endpointId, data: { status: "disabled" } },
            );
          },
        },
        emit: async (
          ctx: ComponentCtx,
          data: {
            enterpriseId: string;
            eventType: string;
            payload: Record<string, unknown>;
            auditEventId?: string;
          },
        ) => {
          await emitEnterpriseWebhookDeliveries(ctx, data);
        },
        delivery: {
          list: async (
            ctx: ComponentReadCtx,
            data: { enterpriseId: string; limit?: number },
          ) => {
            return await ctx.runQuery(
              (config.component.public as any).enterpriseWebhookDeliveryList,
              data,
            );
          },
          listReady: async (ctx: ComponentReadCtx, limit?: number) => {
            return await ctx.runQuery(
              config.component.public.enterpriseWebhookDeliveryListReady,
              { now: Date.now(), limit },
            );
          },
          markDelivered: async (
            ctx: ComponentCtx,
            deliveryId: string,
            responseStatus?: number,
          ) => {
            await ctx.runMutation(
              config.component.public.enterpriseWebhookDeliveryPatch,
              {
                deliveryId,
                data: {
                  status: "delivered",
                  attemptCount: 1,
                  lastAttemptAt: Date.now(),
                  lastResponseStatus: responseStatus,
                },
              },
            );
          },
          markFailed: async (
            ctx: ComponentCtx,
            deliveryId: string,
            data: {
              attemptCount: number;
              responseStatus?: number;
              error?: string;
              retryAt?: number;
            },
          ) => {
            await ctx.runMutation(
              config.component.public.enterpriseWebhookDeliveryPatch,
              {
                deliveryId,
                data: {
                  status: data.retryAt ? "pending" : "failed",
                  attemptCount: data.attemptCount,
                  lastAttemptAt: Date.now(),
                  lastResponseStatus: data.responseStatus,
                  lastError: data.error,
                  nextAttemptAt: data.retryAt ?? Date.now(),
                },
              },
            );
          },
        },
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

        if (hasSSO) {
          http.route({
            pathPrefix: `${ENTERPRISE_CONTROL_ROUTE_BASE}/`,
            method: "GET",
            handler: httpActionGeneric(
              convertErrorsToResponse(400, async (ctx, request) => {
                const runtimePathname = new URL(request.url).pathname;
                const runtimePrefix = `${ENTERPRISE_CONTROL_ROUTE_BASE}/`;
                const runtimeParts = runtimePathname.startsWith(runtimePrefix)
                  ? runtimePathname
                      .slice(runtimePrefix.length)
                      .split("/")
                      .filter(Boolean)
                  : [];
                const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
                const runtimeRoute =
                  runtimeEnterpriseId !== undefined &&
                  (protocol === "oidc" ||
                    protocol === "saml" ||
                    protocol === "scim") &&
                  rest.length > 0
                    ? ({
                        enterpriseId: runtimeEnterpriseId,
                        protocol,
                        rest,
                      } as const)
                    : null;
                if (!runtimeRoute) {
                  throw new AuthError(
                    "INVALID_PARAMETERS",
                    "Invalid enterprise runtime path.",
                  ).toConvexError();
                }
                if (
                  runtimeRoute.protocol === "saml" &&
                  runtimeRoute.rest.length === 1 &&
                  runtimeRoute.rest[0] === "metadata"
                ) {
                  const enterpriseDoc = await ctx.runQuery(
                    config.component.public.enterpriseGet,
                    {
                      enterpriseId: runtimeRoute.enterpriseId,
                    },
                  );
                  if (enterpriseDoc === null) {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise not found.",
                    ).toConvexError();
                  }
                  const loaded = {
                    source: {
                      kind: "enterprise" as const,
                      id: runtimeRoute.enterpriseId,
                    },
                    config: enterpriseDoc.config,
                    status: enterpriseDoc.status,
                  };
                  if (!isEnterpriseSamlSourceActive(loaded)) {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise connection is not active.",
                    ).toConvexError();
                  }
                  const samlConfig = getSamlConfig(loaded.config);
                  if (!samlConfig.idp?.metadataXml) {
                    throw new AuthError(
                      "PROVIDER_NOT_CONFIGURED",
                      "SAML is not configured for this enterprise.",
                    ).toConvexError();
                  }
                  return new Response(
                    createEnterpriseSamlMetadataXml({
                      rootUrl: requireEnv("CONVEX_SITE_URL"),
                      source: loaded.source,
                      config: loaded.config,
                    }),
                    {
                      status: 200,
                      headers: { "Content-Type": "application/xml" },
                    },
                  );
                }
                if (
                  runtimeRoute.protocol === "saml" &&
                  runtimeRoute.rest.length === 1 &&
                  runtimeRoute.rest[0] === "signin"
                ) {
                  const url = new URL(request.url);
                  const verifier = url.searchParams.get("code");
                  if (!verifier) {
                    throw new AuthError(
                      "OAUTH_MISSING_VERIFIER",
                    ).toConvexError();
                  }
                  const enterpriseDoc = await ctx.runQuery(
                    config.component.public.enterpriseGet,
                    {
                      enterpriseId: runtimeRoute.enterpriseId,
                    },
                  );
                  if (enterpriseDoc === null) {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise not found.",
                    ).toConvexError();
                  }
                  const loaded = {
                    source: {
                      kind: "enterprise" as const,
                      id: runtimeRoute.enterpriseId,
                    },
                    config: enterpriseDoc.config,
                    status: enterpriseDoc.status,
                    enterprise: enterpriseDoc,
                  };
                  if (!isEnterpriseSamlSourceActive(loaded)) {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise connection is not active.",
                    ).toConvexError();
                  }
                  const samlConfig = getSamlConfig(loaded.config);
                  if (!samlConfig.idp?.metadataXml) {
                    throw new AuthError(
                      "PROVIDER_NOT_CONFIGURED",
                      "SAML is not configured for this enterprise.",
                    ).toConvexError();
                  }
                  const enterprise = loaded.enterprise;
                  const state = generateRandomString(24, INVITE_TOKEN_ALPHABET);
                  const signInRequest = createEnterpriseSamlSignInRequest({
                    rootUrl: requireEnv("CONVEX_SITE_URL"),
                    source: { kind: "enterprise", id: enterprise._id },
                    config: loaded.config,
                    state,
                    signature: `saml ${enterprise._id} pending ${state}`,
                    redirectTo: url.searchParams.get("redirectTo") ?? undefined,
                  });
                  const signature = `saml ${enterprise._id} ${signInRequest.requestId} ${state}`;
                  await callVerifierSignature(ctx, { verifier, signature });
                  const redirectTo = url.searchParams.get("redirectTo");
                  const redirectCookies =
                    redirectTo !== null
                      ? [
                          redirectToParamCookie(
                            enterpriseSamlProviderId(enterprise._id),
                            redirectTo,
                          ),
                        ]
                      : [];
                  const relayState = encodeEnterpriseSamlRelayState({
                    source: { kind: "enterprise", id: enterprise._id },
                    signature,
                    requestId: signInRequest.requestId,
                    state,
                    redirectTo: url.searchParams.get("redirectTo") ?? undefined,
                  });
                  if (
                    signInRequest.binding === "redirect" &&
                    signInRequest.redirectUrl
                  ) {
                    const redirectUrl = new URL(signInRequest.redirectUrl);
                    redirectUrl.searchParams.set("RelayState", relayState);
                    const headers = new Headers({
                      Location: redirectUrl.toString(),
                    });
                    for (const {
                      name,
                      value,
                      options,
                    } of redirectCookies as any) {
                      headers.append(
                        "Set-Cookie",
                        serializeCookie(name, value, options),
                      );
                    }
                    return new Response(null, { status: 302, headers });
                  }
                  const response = createSamlPostBindingResponse({
                    endpoint: signInRequest.post!.endpoint,
                    parameter: "SAMLRequest",
                    value: signInRequest.post!.value,
                    relayState,
                  });
                  for (const {
                    name,
                    value,
                    options,
                  } of redirectCookies as any) {
                    response.headers.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return response;
                }
                if (
                  runtimeRoute.protocol === "saml" &&
                  runtimeRoute.rest.length === 1 &&
                  runtimeRoute.rest[0] === "acs"
                ) {
                  return await samlAcsHandler(ctx, request);
                }
                if (
                  runtimeRoute.protocol === "saml" &&
                  runtimeRoute.rest.length === 1 &&
                  runtimeRoute.rest[0] === "slo"
                ) {
                  return await samlSloHandler(ctx, request);
                }
                if (
                  runtimeRoute.protocol === "oidc" &&
                  runtimeRoute.rest.length === 1 &&
                  runtimeRoute.rest[0] === "signin"
                ) {
                  const url = new URL(request.url);
                  const verifier = url.searchParams.get("code");
                  if (!verifier) {
                    throw new AuthError(
                      "OAUTH_MISSING_VERIFIER",
                    ).toConvexError();
                  }
                  const enterprise = await ctx.runQuery(
                    config.component.public.enterpriseGet,
                    {
                      enterpriseId: runtimeRoute.enterpriseId,
                    },
                  );
                  if (enterprise === null) {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise not found.",
                    ).toConvexError();
                  }
                  if (enterprise.status !== "active") {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise connection is not active.",
                    ).toConvexError();
                  }
                  const oidc = getOidcConfig(enterprise.config);
                  if (oidc.enabled !== true) {
                    throw new AuthError(
                      "PROVIDER_NOT_CONFIGURED",
                      "OIDC is not configured for this enterprise.",
                    ).toConvexError();
                  }
                  const { providerId, provider, oauthConfig } =
                    await createEnterpriseOidcRuntime({
                      rootUrl: requireEnv("CONVEX_SITE_URL"),
                      enterpriseId: enterprise._id,
                      config: enterprise.config,
                    });
                  const { redirect, cookies, signature } =
                    await createOAuthAuthorizationURL(
                      providerId,
                      provider,
                      oauthConfig,
                    );
                  await callVerifierSignature(ctx, { verifier, signature });
                  const redirectTo = url.searchParams.get("redirectTo");
                  const headers_ = new Headers({ Location: redirect });
                  for (const { name, value, options } of [
                    ...cookies,
                    ...(redirectTo !== null
                      ? [redirectToParamCookie(providerId, redirectTo)]
                      : []),
                  ] as any) {
                    headers_.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return new Response(null, {
                    status: 302,
                    headers: headers_,
                  });
                }
                if (
                  runtimeRoute.protocol === "oidc" &&
                  runtimeRoute.rest.length === 1 &&
                  runtimeRoute.rest[0] === "callback"
                ) {
                  const url = new URL(request.url);
                  const enterpriseId = runtimeRoute.enterpriseId;
                  const enterprise = await ctx.runQuery(
                    config.component.public.enterpriseGet,
                    {
                      enterpriseId,
                    },
                  );
                  if (enterprise === null) {
                    throw new AuthError(
                      "INVALID_PARAMETERS",
                      "Enterprise not found.",
                    ).toConvexError();
                  }
                  const oidc = getOidcConfig(enterprise.config);
                  const { providerId, provider, oauthConfig } =
                    await createEnterpriseOidcRuntime({
                      rootUrl: requireEnv("CONVEX_SITE_URL"),
                      enterpriseId: enterprise._id,
                      config: enterprise.config,
                    });
                  const cookies = getCookies(request);
                  const maybeRedirectTo = useRedirectToParam(
                    providerId,
                    cookies,
                  );
                  const destinationUrl = await redirectAbsoluteUrl(config, {
                    redirectTo: maybeRedirectTo?.redirectTo,
                  });
                  const params = url.searchParams;
                  const result = await Fx.run(
                    handleOAuthCallback(
                      providerId,
                      provider,
                      oauthConfig,
                      Object.fromEntries(params.entries()),
                      cookies,
                    ),
                  );
                  // Apply OIDC extra field mapping if configured
                  const extraFields = oidc.extraFields as
                    | Record<string, string>
                    | undefined;
                  let profile = result.profile as Record<string, unknown>;
                  if (extraFields && typeof profile === "object" && profile) {
                    const extend: Record<string, unknown> = {};
                    for (const [claimName, fieldName] of Object.entries(
                      extraFields,
                    )) {
                      if (claimName in profile) {
                        extend[fieldName] = profile[claimName];
                      }
                    }
                    if (Object.keys(extend).length > 0) {
                      profile = { ...profile, extend };
                    }
                  }

                  const verificationCode = await callUserOAuth(ctx, {
                    provider: providerId,
                    providerAccountId: result.providerAccountId,
                    profile,
                    signature: result.signature,
                    accountExtend: {
                      identity: {
                        protocol: "oidc",
                        enterpriseId: enterprise._id,
                        subject: result.providerAccountId,
                        issuer:
                          typeof oidc.issuer === "string"
                            ? oidc.issuer
                            : undefined,
                        discoveryUrl:
                          typeof oidc.discoveryUrl === "string"
                            ? oidc.discoveryUrl
                            : undefined,
                      },
                    },
                  });
                  const headers = new Headers({
                    Location: setURLSearchParam(
                      destinationUrl,
                      "code",
                      verificationCode,
                    ),
                  });
                  for (const { name, value, options } of result.cookies) {
                    headers.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options as any),
                    );
                  }
                  if (maybeRedirectTo) {
                    headers.append(
                      "Set-Cookie",
                      serializeCookie(
                        maybeRedirectTo.updatedCookie.name,
                        maybeRedirectTo.updatedCookie.value,
                        maybeRedirectTo.updatedCookie.options as any,
                      ),
                    );
                  }
                  return new Response(null, { status: 302, headers });
                }
                if (
                  runtimeRoute.protocol === "scim" &&
                  runtimeRoute.rest[0] === "v2"
                ) {
                  return await enterpriseScimHandler(ctx, request);
                }
                throw new AuthError(
                  "INVALID_PARAMETERS",
                  "Invalid enterprise runtime path.",
                ).toConvexError();
              }),
            ),
          });

          http.route({
            pathPrefix: `${ENTERPRISE_CONTROL_ROUTE_BASE}/`,
            method: "POST",
            handler: httpActionGeneric(
              convertErrorsToResponse(400, async (ctx, request) => {
                const runtimePathname = new URL(request.url).pathname;
                const runtimePrefix = `${ENTERPRISE_CONTROL_ROUTE_BASE}/`;
                const runtimeParts = runtimePathname.startsWith(runtimePrefix)
                  ? runtimePathname
                      .slice(runtimePrefix.length)
                      .split("/")
                      .filter(Boolean)
                  : [];
                const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
                const runtimeRoute =
                  runtimeEnterpriseId !== undefined &&
                  (protocol === "oidc" ||
                    protocol === "saml" ||
                    protocol === "scim") &&
                  rest.length > 0
                    ? ({
                        pathname: runtimePathname,
                        enterpriseId: runtimeEnterpriseId,
                        protocol,
                        rest,
                      } as const)
                    : null;
                if (runtimeRoute) {
                  if (
                    runtimeRoute.protocol === "saml" &&
                    runtimeRoute.rest.length === 1 &&
                    runtimeRoute.rest[0] === "acs"
                  ) {
                    return await samlAcsHandler(ctx, request);
                  }
                  if (
                    runtimeRoute.protocol === "saml" &&
                    runtimeRoute.rest.length === 1 &&
                    runtimeRoute.rest[0] === "slo"
                  ) {
                    return await samlSloHandler(ctx, request);
                  }
                  if (
                    runtimeRoute.protocol === "scim" &&
                    runtimeRoute.rest[0] === "v2"
                  ) {
                    return await enterpriseScimHandler(ctx, request);
                  }
                  throw new AuthError(
                    "INVALID_PARAMETERS",
                    "Invalid enterprise runtime path.",
                  ).toConvexError();
                }
                throw new AuthError(
                  "INVALID_PARAMETERS",
                  "Invalid enterprise runtime path.",
                ).toConvexError();
              }),
            ),
          });

          http.route({
            pathPrefix: `${ENTERPRISE_CONTROL_ROUTE_BASE}/`,
            method: "PUT",
            handler: httpActionGeneric(
              convertErrorsToResponse(400, async (ctx, request) => {
                const runtimePathname = new URL(request.url).pathname;
                const runtimePrefix = `${ENTERPRISE_CONTROL_ROUTE_BASE}/`;
                const runtimeParts = runtimePathname.startsWith(runtimePrefix)
                  ? runtimePathname
                      .slice(runtimePrefix.length)
                      .split("/")
                      .filter(Boolean)
                  : [];
                const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
                const runtimeRoute =
                  runtimeEnterpriseId !== undefined &&
                  (protocol === "oidc" ||
                    protocol === "saml" ||
                    protocol === "scim") &&
                  rest.length > 0
                    ? ({
                        pathname: runtimePathname,
                        enterpriseId: runtimeEnterpriseId,
                        protocol,
                        rest,
                      } as const)
                    : null;
                if (runtimeRoute) {
                  if (
                    runtimeRoute.protocol === "scim" &&
                    runtimeRoute.rest[0] === "v2"
                  ) {
                    return await enterpriseScimHandler(ctx, request);
                  }
                  throw new AuthError(
                    "INVALID_PARAMETERS",
                    "Invalid enterprise runtime path.",
                  ).toConvexError();
                }
                throw new AuthError(
                  "INVALID_PARAMETERS",
                  "Invalid enterprise runtime path.",
                ).toConvexError();
              }),
            ),
          });

          const samlAcsHandler = convertErrorsToResponse(
            400,
            async (ctx, request) =>
              Fx.run(
                Fx.gen(function* () {
                  const runtimePathname = new URL(request.url).pathname;
                  const runtimePrefix = `${ENTERPRISE_CONTROL_ROUTE_BASE}/`;
                  const runtimeParts = runtimePathname.startsWith(runtimePrefix)
                    ? runtimePathname
                        .slice(runtimePrefix.length)
                        .split("/")
                        .filter(Boolean)
                    : [];
                  const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
                  const runtimeRoute =
                    runtimeEnterpriseId !== undefined &&
                    (protocol === "oidc" ||
                      protocol === "saml" ||
                      protocol === "scim") &&
                    rest.length > 0
                      ? ({
                          pathname: runtimePathname,
                          enterpriseId: runtimeEnterpriseId,
                          protocol,
                          rest,
                        } as const)
                      : null;
                  yield* Fx.guard(
                    !runtimeRoute ||
                      runtimeRoute.protocol !== "saml" ||
                      runtimeRoute.rest.length !== 1 ||
                      runtimeRoute.rest[0] !== "acs",
                    Fx.fail(
                      new AuthError(
                        "INVALID_PARAMETERS",
                        "Invalid enterprise runtime path.",
                      ).toConvexError(),
                    ),
                  );

                  const enterpriseId = runtimeRoute!.enterpriseId;
                  const { loaded, saml } = yield* Fx.from({
                    ok: async () => {
                      const enterprise = await ctx.runQuery(
                        config.component.public.enterpriseGet,
                        {
                          enterpriseId,
                        },
                      );
                      if (enterprise === null) {
                        throw new AuthError(
                          "INVALID_PARAMETERS",
                          "Enterprise not found.",
                        ).toConvexError();
                      }
                      const loaded = {
                        source: {
                          kind: "enterprise" as const,
                          id: enterpriseId,
                        },
                        config: enterprise.config,
                        status: enterprise.status,
                        enterprise,
                      };
                      if (!isEnterpriseSamlSourceActive(loaded)) {
                        throw new AuthError(
                          "INVALID_PARAMETERS",
                          "Enterprise connection is not active.",
                        ).toConvexError();
                      }
                      const saml = getSamlConfig(loaded.config);
                      if (!saml.idp?.metadataXml) {
                        throw new AuthError(
                          "PROVIDER_NOT_CONFIGURED",
                          "SAML is not configured for this enterprise.",
                        ).toConvexError();
                      }
                      return { loaded, saml };
                    },
                    err: (e) => e,
                  });

                  const enterprise = loaded.enterprise;

                  const parsedResponse = yield* Fx.from({
                    ok: () =>
                      parseEnterpriseSamlLoginResponse({
                        request,
                        rootUrl: requireEnv("CONVEX_SITE_URL"),
                        source: { kind: "enterprise", id: enterprise._id },
                        config: loaded.config,
                      }),
                    err: (e) =>
                      new AuthError(
                        "OAUTH_PROVIDER_ERROR",
                        `SAML response parse failed: ${e instanceof Error ? e.message : String(e)}`,
                      ).toConvexError(),
                  });

                  yield* Fx.from({
                    ok: () => {
                      validateEnterpriseSamlLoginRelayState({
                        relayState: parsedResponse.relayState,
                        source: { kind: "enterprise", id: enterprise._id },
                        inResponseTo:
                          parsedResponse.parsed.extract?.response?.inResponseTo,
                      });
                      return Promise.resolve();
                    },
                    err: () =>
                      new AuthError(
                        "OAUTH_INVALID_STATE",
                        "SAML RelayState did not match the pending login request.",
                      ).toConvexError(),
                  });

                  // samlAttributes and samlSessionIndex are SAML-specific — they
                  // must not be stored in the User document. Put them in the
                  // account extend payload and pass only standard fields to the
                  // user upsert.
                  const { samlAttributes, samlSessionIndex, ...userProfile } =
                    profileFromSamlExtract(
                      parsedResponse.parsed.extract,
                      saml.attributeMapping,
                    );
                  const profile = userProfile as Record<string, unknown> & {
                    id: string;
                  };

                  const maybeRedirectTo = useRedirectToParam(
                    enterpriseSamlProviderId(enterprise._id),
                    getCookies(request),
                  );

                  const verificationCode = yield* Fx.from({
                    ok: () =>
                      callUserOAuth(ctx, {
                        provider: enterpriseSamlProviderId(enterprise._id),
                        providerAccountId: profile.id,
                        profile,
                        signature: parsedResponse.relayState.signature,
                        accountExtend: {
                          identity: {
                            protocol: "saml",
                            enterpriseId: enterprise._id,
                            subject: profile.id,
                            entityId:
                              typeof saml.entityId === "string"
                                ? saml.entityId
                                : undefined,
                          },
                          saml: {
                            attributes: samlAttributes,
                            sessionIndex: samlSessionIndex,
                          },
                        },
                      }),
                    err: (e) => e,
                  });

                  const destinationUrl = yield* Fx.from({
                    ok: () =>
                      redirectAbsoluteUrl(config, {
                        redirectTo:
                          maybeRedirectTo?.redirectTo ??
                          (typeof parsedResponse.relayState.redirectTo ===
                          "string"
                            ? parsedResponse.relayState.redirectTo
                            : undefined),
                      }),
                    err: (e) => e,
                  });

                  const vurl = setURLSearchParam(
                    destinationUrl,
                    "code",
                    verificationCode,
                  );
                  const vheaders = new Headers({ Location: vurl });
                  vheaders.set("Cache-Control", "must-revalidate");
                  for (const { name, value, options } of maybeRedirectTo !==
                  null
                    ? [maybeRedirectTo.updatedCookie]
                    : []) {
                    vheaders.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return new Response(null, { status: 302, headers: vheaders });
                }).pipe(Fx.recover((e) => Fx.fatal(e))),
              ),
          );

          const samlSloHandler = convertErrorsToResponse(
            400,
            async (ctx, request) => {
              const runtimePathname = new URL(request.url).pathname;
              const runtimePrefix = `${ENTERPRISE_CONTROL_ROUTE_BASE}/`;
              const runtimeParts = runtimePathname.startsWith(runtimePrefix)
                ? runtimePathname
                    .slice(runtimePrefix.length)
                    .split("/")
                    .filter(Boolean)
                : [];
              const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
              const runtimeRoute =
                runtimeEnterpriseId !== undefined &&
                (protocol === "oidc" ||
                  protocol === "saml" ||
                  protocol === "scim") &&
                rest.length > 0
                  ? ({
                      pathname: runtimePathname,
                      enterpriseId: runtimeEnterpriseId,
                      protocol,
                      rest,
                    } as const)
                  : null;
              if (
                !runtimeRoute ||
                runtimeRoute.protocol !== "saml" ||
                runtimeRoute.rest.length !== 1 ||
                runtimeRoute.rest[0] !== "slo"
              ) {
                throw new AuthError(
                  "INVALID_PARAMETERS",
                  "Invalid enterprise runtime path.",
                ).toConvexError();
              }
              const enterpriseId = runtimeRoute.enterpriseId;
              const enterpriseDoc = await ctx.runQuery(
                config.component.public.enterpriseGet,
                {
                  enterpriseId,
                },
              );
              if (enterpriseDoc === null) {
                throw new AuthError(
                  "INVALID_PARAMETERS",
                  "Enterprise not found.",
                ).toConvexError();
              }
              const loaded = {
                source: { kind: "enterprise" as const, id: enterpriseId },
                config: enterpriseDoc.config,
                status: enterpriseDoc.status,
                enterprise: enterpriseDoc,
              };
              if (!isEnterpriseSamlSourceActive(loaded)) {
                throw new AuthError(
                  "INVALID_PARAMETERS",
                  "Enterprise connection is not active.",
                ).toConvexError();
              }
              const saml = getSamlConfig(loaded.config);
              if (!saml.idp?.metadataXml) {
                throw new AuthError(
                  "PROVIDER_NOT_CONFIGURED",
                  "SAML is not configured for this enterprise.",
                ).toConvexError();
              }
              const enterprise = loaded.enterprise;
              const parsedMessage = await parseEnterpriseSamlLogoutMessage({
                request,
                rootUrl: requireEnv("CONVEX_SITE_URL"),
                source: { kind: "enterprise", id: enterprise._id },
                config: loaded.config,
              });
              if (parsedMessage.hasSamlRequest && parsedMessage.parsedRequest) {
                const responseContext =
                  parsedMessage.runtime.sp.createLogoutResponse(
                    parsedMessage.runtime.idp as any,
                    parsedMessage.parsedRequest.extract,
                    parsedMessage.binding as any,
                    parsedMessage.relayState ?? "",
                  ) as any;
                if (parsedMessage.binding === "redirect") {
                  return new Response(null, {
                    status: 302,
                    headers: { Location: responseContext.context },
                  });
                }
                return createSamlPostBindingResponse({
                  endpoint: responseContext.entityEndpoint,
                  parameter: "SAMLResponse",
                  value: responseContext.context,
                  relayState: parsedMessage.relayState,
                });
              }
              if (parsedMessage.hasSamlResponse) {
                return new Response(null, { status: 204 });
              }
              throw new AuthError(
                "INVALID_PARAMETERS",
                "Missing SAML logout payload.",
              ).toConvexError();
            },
          );

          const enterpriseScimHandler = async (
            ctx: GenericActionCtx<any>,
            request: Request,
          ) => {
            try {
              const { scimConfig, enterprise, parsedPath } =
                await getEnterpriseScimContext(ctx, request);
              const url = new URL(request.url);
              const state: ScimState = {
                ctx,
                request,
                url,
                parsedPath,
                enterprise,
                scimConfig,
                recordScimEvent: async (
                  eventType,
                  ok,
                  subjectType,
                  subjectId,
                  metadata,
                ) => {
                  const auditEventId = await recordEnterpriseAuditEvent(ctx, {
                    enterpriseId: enterprise._id,
                    groupId: enterprise.groupId,
                    eventType,
                    actorType: "scim",
                    subjectType,
                    subjectId,
                    ok,
                    metadata,
                  });
                  await emitEnterpriseWebhookDeliveries(ctx, {
                    enterpriseId: enterprise._id,
                    eventType,
                    auditEventId,
                    payload: {
                      enterpriseId: enterprise._id,
                      subjectId,
                      metadata,
                    },
                  });
                },
              };

              const handleUsersGet: ScimHandler = async (state) => {
                const members = await auth.member.list(state.ctx, {
                  where: { groupId: state.enterprise.groupId },
                  limit: 100,
                });
                const identities = await state.ctx.runQuery(
                  config.component.public
                    .enterpriseScimIdentityListByEnterprise,
                  { enterpriseId: state.enterprise._id },
                );
                const identityByUserId = new Map(
                  identities
                    .filter((identity: any) => identity.userId !== undefined)
                    .map((identity: any) => [identity.userId, identity]),
                );
                const users = (
                  await Promise.all(
                    members.items.map(async (member: any) => {
                      const user = await auth.user.get(
                        state.ctx,
                        member.userId,
                      );
                      return user
                        ? {
                            user,
                            member,
                            identity: identityByUserId.get(user._id),
                          }
                        : null;
                    }),
                  )
                ).filter(Boolean) as Array<{
                  user: any;
                  member: any;
                  identity?: any;
                }>;
                const listRequest = parseScimListRequest(state.url);
                const filtered = filterScimCollection(
                  users,
                  listRequest.filter,
                  {
                    id: (item: { user: any }, value: string) =>
                      item.user._id === value,
                    externalId: (item: { identity?: any }, value: string) =>
                      item.identity?.externalId === value,
                    userName: (item: { user: any }, value: string) =>
                      item.user.email === value,
                    "emails.value": (item: { user: any }, value: string) =>
                      item.user.email === value,
                    active: (
                      item: { identity?: any; member: any },
                      value: string,
                    ) =>
                      String(
                        item.identity?.active ??
                          item.member.status === "active",
                      ) === value,
                  },
                );
                if (state.parsedPath.resourceId) {
                  const resource = filtered.find(
                    ({ user }) => user._id === state.parsedPath.resourceId,
                  );
                  return resource
                    ? scimJson(
                        serializeScimUser({
                          id: resource.user._id,
                          user: resource.user,
                          externalId: resource.identity?.externalId,
                          location: `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.user._id}`,
                          active:
                            resource.identity?.active ??
                            resource.member.status === "active",
                        }),
                        200,
                        {
                          Location: `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.user._id}`,
                        },
                      )
                    : scimError(404, "notFound", "User not found.");
                }
                const paged = paginateScimCollection(filtered, listRequest);
                await state.recordScimEvent(
                  "enterprise.scim.read",
                  true,
                  "enterprise_scim",
                  state.scimConfig._id,
                );
                return scimJson({
                  schemas: [
                    "urn:ietf:params:scim:api:messages:2.0:ListResponse",
                  ],
                  Resources: paged.map(({ user, identity, member }) =>
                    serializeScimUser({
                      id: user._id,
                      user,
                      externalId: identity?.externalId,
                      location: `${state.url.origin}${state.url.pathname}/${user._id}`,
                      active: identity?.active ?? member.status === "active",
                    }),
                  ),
                  totalResults: filtered.length,
                  startIndex: listRequest.startIndex,
                  itemsPerPage: paged.length,
                });
              };

              const handleUsersPost: ScimHandler = async (state) => {
                const body = await readScimJson(state.request);
                const primaryEmail = Array.isArray(body.emails)
                  ? (body.emails.find((entry) => entry.primary === true)
                      ?.value ?? body.emails[0]?.value)
                  : undefined;
                const phone = Array.isArray(body.phoneNumbers)
                  ? body.phoneNumbers[0]?.value
                  : undefined;
                const userId = (await state.ctx.runMutation(
                  config.component.public.userInsert,
                  {
                    data: {
                      name: body.displayName ?? body.name?.formatted,
                      email: primaryEmail ?? body.userName,
                      ...(typeof (primaryEmail ?? body.userName) === "string"
                        ? { emailVerificationTime: Date.now() }
                        : {}),
                      phone,
                      ...(typeof phone === "string"
                        ? { phoneVerificationTime: Date.now() }
                        : {}),
                    },
                  },
                )) as string;
                try {
                  await auth.member.add(state.ctx, {
                    groupId: state.enterprise.groupId,
                    userId,
                    role: "member",
                    status: body.active === false ? "inactive" : "active",
                  });
                } catch {}
                await state.ctx.runMutation(
                  config.component.public.enterpriseScimIdentityUpsert,
                  {
                    enterpriseId: state.enterprise._id,
                    groupId: state.enterprise.groupId,
                    resourceType: "user",
                    externalId:
                      typeof body.externalId === "string"
                        ? body.externalId
                        : undefined,
                    userId,
                    active: body.active !== false,
                    raw: body,
                    lastProvisionedAt: Date.now(),
                  },
                );
                await state.recordScimEvent(
                  "enterprise.scim.user.created",
                  true,
                  "user",
                  userId,
                );
                const createdUser = await auth.user.get(state.ctx, userId);
                const location = `${state.url.origin}${state.url.pathname}/${userId}`;
                return scimJson(
                  serializeScimUser({
                    id: userId,
                    user: createdUser ?? {},
                    externalId: body.externalId,
                    location,
                    active: body.active !== false,
                  }),
                  201,
                  { Location: location },
                );
              };

              const handleUsersUpsert: ScimHandler = async (state) => {
                const missing = requireScimResourceId(
                  state.parsedPath.resourceId,
                  "User",
                );
                if (missing) return missing;
                const userId = state.parsedPath.resourceId!;
                const existingUser = await auth.user.get(state.ctx, userId);
                if (!existingUser) {
                  return scimError(404, "notFound", "User not found.");
                }
                const body = await readScimJson(state.request);
                const patchData: Record<string, unknown> = {};
                let nextActive: boolean | undefined;
                if (state.request.method === "PUT") {
                  patchData.name = body.displayName ?? body.name?.formatted;
                  patchData.email =
                    body.userName ??
                    (Array.isArray(body.emails)
                      ? body.emails[0]?.value
                      : undefined);
                  patchData.phone = Array.isArray(body.phoneNumbers)
                    ? body.phoneNumbers[0]?.value
                    : undefined;
                  if (typeof patchData.email === "string") {
                    patchData.emailVerificationTime = Date.now();
                  }
                  if (typeof patchData.phone === "string") {
                    patchData.phoneVerificationTime = Date.now();
                  }
                } else {
                  for (const operation of Array.isArray(body.Operations)
                    ? body.Operations
                    : []) {
                    if (operation.path === "active") {
                      nextActive = operation.value;
                    }
                    if (
                      operation.path === "displayName" ||
                      operation.path === "name.formatted"
                    ) {
                      patchData.name = operation.value;
                    }
                    if (
                      operation.path === "userName" ||
                      operation.path === "emails.value"
                    ) {
                      patchData.email = operation.value;
                      if (typeof operation.value === "string") {
                        patchData.emailVerificationTime = Date.now();
                      }
                    }
                    if (operation.path === "phoneNumbers.value") {
                      patchData.phone = operation.value;
                      if (typeof operation.value === "string") {
                        patchData.phoneVerificationTime = Date.now();
                      }
                    }
                  }
                }
                await state.ctx.runMutation(config.component.public.userPatch, {
                  userId,
                  data: patchData,
                });
                const membership = await auth.member.getByUserAndGroup(
                  state.ctx,
                  {
                    groupId: state.enterprise.groupId,
                    userId,
                  },
                );
                if (membership) {
                  await auth.member.update(state.ctx, membership._id, {
                    status:
                      body.active === false || nextActive === false
                        ? "inactive"
                        : "active",
                  });
                }
                await state.ctx.runMutation(
                  config.component.public.enterpriseScimIdentityUpsert,
                  {
                    enterpriseId: state.enterprise._id,
                    groupId: state.enterprise.groupId,
                    resourceType: "user",
                    externalId:
                      typeof body.externalId === "string"
                        ? body.externalId
                        : undefined,
                    userId,
                    active: body.active !== false && nextActive !== false,
                    raw: body,
                    lastProvisionedAt: Date.now(),
                  },
                );
                await state.recordScimEvent(
                  "enterprise.scim.user.updated",
                  true,
                  "user",
                  userId,
                );
                const updatedUser = await auth.user.get(state.ctx, userId);
                const location = `${state.url.origin}${state.url.pathname}`;
                return scimJson(
                  serializeScimUser({
                    id: userId,
                    user: updatedUser ?? existingUser,
                    externalId:
                      typeof body.externalId === "string"
                        ? body.externalId
                        : undefined,
                    location,
                    active: body.active !== false && nextActive !== false,
                  }),
                  200,
                  { Location: location },
                );
              };

              const handleUsersDelete: ScimHandler = async (state) => {
                const missing = requireScimResourceId(
                  state.parsedPath.resourceId,
                  "User",
                );
                if (missing) return missing;
                const userId = state.parsedPath.resourceId!;
                const membership = await auth.member.getByUserAndGroup(
                  state.ctx,
                  {
                    groupId: state.enterprise.groupId,
                    userId,
                  },
                );
                if (membership) {
                  await auth.member.remove(state.ctx, membership._id);
                }
                const identity = await state.ctx.runQuery(
                  config.component.public.enterpriseScimIdentityGetByUser,
                  { userId },
                );
                if (identity) {
                  if (state.scimConfig.deprovisionMode === "hard") {
                    await state.ctx.runMutation(
                      config.component.public.enterpriseScimIdentityDelete,
                      { identityId: identity._id },
                    );
                  } else {
                    await state.ctx.runMutation(
                      config.component.public.enterpriseScimIdentityUpsert,
                      {
                        enterpriseId: identity.enterpriseId,
                        groupId: identity.groupId,
                        resourceType: identity.resourceType,
                        externalId: identity.externalId,
                        userId: identity.userId,
                        mappedGroupId: identity.mappedGroupId,
                        active: false,
                        raw: identity.raw,
                        lastProvisionedAt: Date.now(),
                      },
                    );
                  }
                }
                await state.recordScimEvent(
                  "enterprise.scim.user.deleted",
                  true,
                  "user",
                  userId,
                );
                return new Response(null, { status: 204 });
              };

              const handleGroupsGet: ScimHandler = async (state) => {
                const groupsList = await auth.group.list(state.ctx, {
                  where: { parentGroupId: state.enterprise.groupId },
                  limit: 100,
                });
                const identities = await state.ctx.runQuery(
                  config.component.public
                    .enterpriseScimIdentityListByEnterprise,
                  { enterpriseId: state.enterprise._id },
                );
                const identityByGroupId = new Map(
                  identities
                    .filter(
                      (identity: any) => identity.mappedGroupId !== undefined,
                    )
                    .map((identity: any) => [identity.mappedGroupId, identity]),
                );
                const groups = groupsList.items.map((group: any) => ({
                  group,
                  identity: identityByGroupId.get(group._id),
                }));
                const listRequest = parseScimListRequest(state.url);
                const filtered = filterScimCollection<{
                  group: any;
                  identity?: any;
                }>(groups, listRequest.filter, {
                  id: (item: { group: any }, value: string) =>
                    item.group._id === value,
                  externalId: (item: { identity?: any }, value: string) =>
                    item.identity?.externalId === value,
                  displayName: (item: { group: any }, value: string) =>
                    item.group.name === value,
                });
                if (state.parsedPath.resourceId) {
                  const resource = filtered.find(
                    ({ group }) => group._id === state.parsedPath.resourceId,
                  );
                  if (!resource) {
                    return scimError(404, "notFound", "Group not found.");
                  }
                  const members = (
                    await auth.member.list(state.ctx, {
                      where: {
                        groupId: resource.group._id,
                        status: "active",
                      },
                      limit: 100,
                    })
                  ).items.map((member: any) => ({ value: member.userId }));
                  const location = `${state.url.origin}${state.url.pathname.replace(/\/[^/]+$/, "")}/${resource.group._id}`;
                  return scimJson(
                    serializeScimGroup({
                      id: resource.group._id,
                      group: resource.group,
                      externalId: resource.identity?.externalId,
                      location,
                      members,
                    }),
                    200,
                    { Location: location },
                  );
                }
                const paged = paginateScimCollection(filtered, listRequest);
                return scimJson({
                  schemas: [
                    "urn:ietf:params:scim:api:messages:2.0:ListResponse",
                  ],
                  Resources: paged.map(({ group, identity }) =>
                    serializeScimGroup({
                      id: group._id,
                      group,
                      externalId: identity?.externalId,
                      location: `${state.url.origin}${state.url.pathname}/${group._id}`,
                    }),
                  ),
                  totalResults: filtered.length,
                  startIndex: listRequest.startIndex,
                  itemsPerPage: paged.length,
                });
              };

              const handleGroupsPost: ScimHandler = async (state) => {
                const body = await readScimJson(state.request);
                const groupId = await auth.group.create(state.ctx, {
                  name: String(body.displayName ?? "Group"),
                  parentGroupId: state.enterprise.groupId,
                  type: "organization",
                });
                await state.ctx.runMutation(
                  config.component.public.enterpriseScimIdentityUpsert,
                  {
                    enterpriseId: state.enterprise._id,
                    groupId: state.enterprise.groupId,
                    resourceType: "group",
                    externalId: body.externalId ?? groupId,
                    mappedGroupId: groupId,
                    active: true,
                    raw: body,
                    lastProvisionedAt: Date.now(),
                  },
                );
                for (const member of Array.isArray(body.members)
                  ? body.members
                  : []) {
                  try {
                    await auth.member.add(state.ctx, {
                      groupId,
                      userId: String(member.value),
                      role: "member",
                      status: "active",
                    });
                  } catch {}
                }
                await state.recordScimEvent(
                  "enterprise.scim.group.created",
                  true,
                  "group",
                  groupId,
                );
                const group = await auth.group.get(state.ctx, groupId);
                const location = `${state.url.origin}${state.url.pathname}/${groupId}`;
                return scimJson(
                  serializeScimGroup({
                    id: groupId,
                    group: group ?? {},
                    externalId: body.externalId,
                    location,
                    members: (
                      await auth.member.list(state.ctx, {
                        where: { groupId, status: "active" },
                        limit: 100,
                      })
                    ).items.map((member: any) => ({ value: member.userId })),
                  }),
                  201,
                  { Location: location },
                );
              };

              const handleGroupsPatch: ScimHandler = async (state) => {
                const missing = requireScimResourceId(
                  state.parsedPath.resourceId,
                  "Group",
                );
                if (missing) return missing;
                const groupId = state.parsedPath.resourceId!;
                const body = await readScimJson(state.request);
                for (const operation of Array.isArray(body.Operations)
                  ? body.Operations
                  : []) {
                  if (operation.path === "displayName") {
                    await auth.group.update(state.ctx, groupId, {
                      name: operation.value,
                    });
                  }
                  if (operation.path === "members" && operation.op === "add") {
                    for (const member of Array.isArray(operation.value)
                      ? operation.value
                      : []) {
                      try {
                        await auth.member.add(state.ctx, {
                          groupId,
                          userId: String(member.value),
                          role: "member",
                          status: "active",
                        });
                      } catch {}
                    }
                  }
                  if (
                    operation.path === "members" &&
                    operation.op === "replace"
                  ) {
                    const currentMembers = (
                      await auth.member.list(state.ctx, {
                        where: { groupId, status: "active" },
                        limit: 100,
                      })
                    ).items as Array<{ _id: string; userId: string }>;
                    const currentUserIds = new Set<string>(
                      currentMembers.map((member) => member.userId),
                    );
                    const nextUserIds = new Set<string>(
                      (Array.isArray(operation.value)
                        ? operation.value
                        : []
                      ).map((member: any) => String(member.value)),
                    );
                    for (const member of currentMembers) {
                      if (!nextUserIds.has(member.userId)) {
                        await auth.member.remove(state.ctx, member._id);
                      }
                    }
                    for (const userId of nextUserIds.values()) {
                      if (!currentUserIds.has(userId)) {
                        try {
                          await auth.member.add(state.ctx, {
                            groupId,
                            userId,
                            role: "member",
                            status: "active",
                          });
                        } catch {}
                      }
                    }
                  }
                  if (
                    typeof operation.path === "string" &&
                    operation.op === "remove" &&
                    operation.path.startsWith("members[")
                  ) {
                    const match = operation.path.match(
                      /^members\[value eq "([^"]+)"\]$/,
                    );
                    const userId = match?.[1];
                    if (userId) {
                      const membership = await auth.member.getByUserAndGroup(
                        state.ctx,
                        { groupId, userId },
                      );
                      if (membership) {
                        await auth.member.remove(state.ctx, membership._id);
                      }
                    }
                  }
                }
                await state.recordScimEvent(
                  "enterprise.scim.group.updated",
                  true,
                  "group",
                  groupId,
                );
                const group = await auth.group.get(state.ctx, groupId);
                const location = `${state.url.origin}${state.url.pathname}`;
                const members = (
                  await auth.member.list(state.ctx, {
                    where: { groupId, status: "active" },
                    limit: 100,
                  })
                ).items as Array<{ userId: string }>;
                return scimJson(
                  serializeScimGroup({
                    id: groupId,
                    group: group ?? {},
                    location,
                    members: members.map((member) => ({
                      value: member.userId,
                    })),
                  }),
                  200,
                  { Location: location },
                );
              };

              const handleGroupsDelete: ScimHandler = async (state) => {
                const missing = requireScimResourceId(
                  state.parsedPath.resourceId,
                  "Group",
                );
                if (missing) return missing;
                const groupId = state.parsedPath.resourceId!;
                await auth.group.delete(state.ctx, groupId);
                const identity = await state.ctx.runQuery(
                  config.component.public
                    .enterpriseScimIdentityGetByMappedGroup,
                  { mappedGroupId: groupId },
                );
                if (identity) {
                  await state.ctx.runMutation(
                    config.component.public.enterpriseScimIdentityDelete,
                    { identityId: identity._id },
                  );
                }
                await state.recordScimEvent(
                  "enterprise.scim.group.deleted",
                  true,
                  "group",
                  groupId,
                );
                return new Response(null, { status: 204 });
              };

              const scimHandlers: Record<
                string,
                Partial<Record<string, ScimHandler>>
              > = {
                ServiceProviderConfig: {
                  GET: async () =>
                    scimJson({
                      schemas: [
                        "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
                      ],
                      patch: { supported: true },
                      bulk: {
                        supported: false,
                        maxOperations: 0,
                        maxPayloadSize: 0,
                      },
                      filter: { supported: true, maxResults: 100 },
                      changePassword: { supported: false },
                      sort: { supported: false },
                      etag: { supported: false },
                      authenticationSchemes: [
                        {
                          type: "oauthbearertoken",
                          name: "Bearer Token",
                          description:
                            "Use the SCIM token generated by Convex Auth enterprise.",
                        },
                      ],
                    }),
                },
                Schemas: {
                  GET: async (state) =>
                    handleStaticScimCollection(
                      SCIM_SCHEMAS,
                      state.parsedPath.resourceId,
                      {
                        by: "id",
                        notFound: "Schema not found.",
                      },
                    ),
                },
                ResourceTypes: {
                  GET: async (state) =>
                    handleStaticScimCollection(
                      SCIM_RESOURCE_TYPES,
                      state.parsedPath.resourceId,
                      { by: "name", notFound: "Resource type not found." },
                    ),
                },
                Users: {
                  GET: handleUsersGet,
                  POST: handleUsersPost,
                  PATCH: handleUsersUpsert,
                  PUT: handleUsersUpsert,
                  DELETE: handleUsersDelete,
                },
                Groups: {
                  GET: handleGroupsGet,
                  POST: handleGroupsPost,
                  PATCH: handleGroupsPatch,
                  DELETE: handleGroupsDelete,
                },
              };

              const handler =
                scimHandlers[state.parsedPath.resource]?.[state.request.method];
              return handler
                ? await handler(state)
                : scimError(404, "notFound", "SCIM resource not found.");
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === "Unsupported SCIM filter."
              ) {
                return scimError(400, "invalidFilter", error.message);
              }
              if (isAuthError(error)) {
                const code = error.data.code as string;
                const status =
                  code === "MISSING_BEARER_TOKEN" || code === "INVALID_API_KEY"
                    ? 401
                    : 400;
                return scimError(status, code, error.data.message);
              }
              throw error;
            }
          };

          for (const method of ["PATCH", "DELETE"] as const) {
            http.route({
              pathPrefix: "/api/auth/sso/",
              method,
              handler: httpActionGeneric(async (ctx, request) => {
                const runtimePathname = new URL(request.url).pathname;
                const runtimePrefix = `${ENTERPRISE_CONTROL_ROUTE_BASE}/`;
                const runtimeParts = runtimePathname.startsWith(runtimePrefix)
                  ? runtimePathname
                      .slice(runtimePrefix.length)
                      .split("/")
                      .filter(Boolean)
                  : [];
                const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
                const runtimeRoute =
                  runtimeEnterpriseId !== undefined &&
                  (protocol === "oidc" ||
                    protocol === "saml" ||
                    protocol === "scim") &&
                  rest.length > 0
                    ? ({
                        pathname: runtimePathname,
                        enterpriseId: runtimeEnterpriseId,
                        protocol,
                        rest,
                      } as const)
                    : null;
                if (
                  !runtimeRoute ||
                  runtimeRoute.protocol !== "scim" ||
                  runtimeRoute.rest[0] !== "v2"
                ) {
                  return scimError(404, "notFound", "SCIM resource not found.");
                }
                return await enterpriseScimHandler(ctx, request);
              }),
            });
          }
        } // end if (hasSSO)

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
                  throw new AuthError("OAUTH_MISSING_PROVIDER").toConvexError();
                }
                const verifier = url.searchParams.get("code");
                if (verifier === null) {
                  throw new AuthError("OAUTH_MISSING_VERIFIER").toConvexError();
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

          const callbackAction = httpActionGeneric(async (ctx, request) => {
            const url = new URL(request.url);
            const providerId = new URL(request.url).pathname.split("/").at(-1);
            if (!providerId) {
              throw new AuthError("OAUTH_MISSING_PROVIDER").toConvexError();
            }
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
              formData.forEach((value, key) => {
                if (typeof value === "string") {
                  params.append(key, value);
                }
              });
            }

            return Fx.run(
              Fx.from({
                ok: async () => {
                  const oauthConfig = provider as OAuthMaterializedConfig;
                  const result = await Fx.run(
                    handleOAuthCallback(
                      providerId,
                      oauthConfig.provider,
                      oauthConfig,
                      Object.fromEntries(params.entries()),
                      cookies,
                    ),
                  );
                  const oauthCookies = result.cookies;
                  const { id: profileId, ...profileData } = result.profile;
                  const { signature } = result;

                  const verificationCode = await callUserOAuth(ctx, {
                    provider: providerId,
                    providerAccountId: profileId,
                    profile: profileData,
                    signature,
                  });

                  const redirUrl = setURLSearchParam(
                    destinationUrl,
                    "code",
                    verificationCode,
                  );
                  const redirHeaders = new Headers({ Location: redirUrl });
                  redirHeaders.set("Cache-Control", "must-revalidate");
                  for (const { name, value, options } of [
                    ...oauthCookies,
                    ...(maybeRedirectTo !== null
                      ? [maybeRedirectTo.updatedCookie]
                      : []),
                  ] as any) {
                    redirHeaders.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return new Response(null, {
                    status: 302,
                    headers: redirHeaders,
                  });
                },
                err: (error) => error,
              }).pipe(
                Fx.recover((error) => {
                  logError(error);
                  const respHeaders = new Headers({ Location: destinationUrl });
                  for (const { name, value, options } of maybeRedirectTo !==
                  null
                    ? [maybeRedirectTo.updatedCookie]
                    : []) {
                    respHeaders.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return Fx.succeed(
                    new Response(null, { status: 302, headers: respHeaders }),
                  );
                }),
              ),
            );
          });

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

        return httpActionGeneric(async (genericCtx, request) => {
          return Fx.run(
            Fx.from({
              ok: async () => {
                // 1. Extract Bearer token
                const authHeader = request.headers.get("Authorization");
                if (!authHeader?.startsWith("Bearer ")) {
                  return new Response(
                    JSON.stringify({
                      error:
                        "Missing or malformed Authorization: Bearer header.",
                      code: "MISSING_BEARER_TOKEN",
                    }),
                    {
                      status: 401,
                      headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                      },
                    },
                  );
                }
                const rawKey = authHeader.slice(7);

                // 2. Verify API key — auth errors become JSON error responses
                const keyResult = await Fx.run(
                  Fx.from({
                    ok: () => auth.key.verify(genericCtx, rawKey),
                    err: (error) => error,
                  }).pipe(
                    Fx.fold({
                      ok: (result) => ({ ok: true, value: result }) as const,
                      err: (error) => ({ ok: false, error }) as const,
                    }),
                  ),
                );

                if (!keyResult.ok) {
                  if (isAuthError(keyResult.error)) {
                    const { code, message } = keyResult.error.data as {
                      code: string;
                      message: string;
                    };
                    return new Response(
                      JSON.stringify({ error: message, code }),
                      {
                        status: 403,
                        headers: {
                          ...corsHeaders,
                          "Content-Type": "application/json",
                        },
                      },
                    );
                  }
                  throw keyResult.error;
                }

                // 3. Optional scope check
                if (options?.scope) {
                  if (
                    !keyResult.value.scopes.can(
                      options.scope.resource,
                      options.scope.action,
                    )
                  ) {
                    return new Response(
                      JSON.stringify({
                        error:
                          "This API key does not have the required permissions.",
                        code: "SCOPE_CHECK_FAILED",
                      }),
                      {
                        status: 403,
                        headers: {
                          ...corsHeaders,
                          "Content-Type": "application/json",
                        },
                      },
                    );
                  }
                }

                // 4. Enrich context with key info
                const enrichedCtx = Object.assign(genericCtx, {
                  key: {
                    userId: keyResult.value.userId,
                    keyId: keyResult.value.keyId,
                    scopes: keyResult.value.scopes,
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
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                });
              },
              err: (error) => error,
            }).pipe(
              Fx.recover((error) => {
                logError(error);
                return Fx.succeed(
                  new Response(
                    JSON.stringify({
                      error: "An unexpected error occurred.",
                      code: "INTERNAL_ERROR",
                    }),
                    {
                      status: 500,
                      headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json",
                      },
                    },
                  ),
                );
              }),
            ),
          );
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
      handler: async (ctx, args): Promise<SignInActionResult> => {
        if (args.calledBy !== undefined) {
          logWithLevel(
            "INFO",
            `\`auth/session:start\` called by ${args.calledBy}`,
          );
        }
        const provider =
          args.provider !== undefined
            ? getProviderOrThrow(args.provider)
            : null;
        const result = await signInImpl(enrichCtx(ctx), provider, args, {
          generateTokens: true,
          allowExtraProviders: false,
        });
        return Fx.run(
          Fx.match(result, result.kind, {
            redirect: (r) =>
              Fx.succeed({
                kind: "redirect" as const,
                redirect: r.redirect,
                verifier: r.verifier,
              }),
            signedIn: (r) =>
              Fx.succeed({
                kind: "signedIn" as const,
                tokens: r.signedIn?.tokens ?? null,
              }),
            refreshTokens: (r) =>
              Fx.succeed({
                kind: "signedIn" as const,
                tokens: r.signedIn?.tokens ?? null,
              }),
            started: () => Fx.succeed({ kind: "started" as const }),
            passkeyOptions: (r) =>
              Fx.succeed({
                kind: "passkeyOptions" as const,
                options: r.options,
                verifier: r.verifier,
              }),
            totpRequired: (r) =>
              Fx.succeed({
                kind: "totpRequired" as const,
                verifier: r.verifier,
              }),
            totpSetup: (r) =>
              Fx.succeed({
                kind: "totpSetup" as const,
                totpSetup: {
                  uri: r.uri,
                  secret: r.secret,
                  totpId: r.totpId,
                },
                verifier: r.verifier,
              }),
            deviceCode: (r) =>
              Fx.succeed({
                kind: "deviceCode" as const,
                deviceCode: {
                  deviceCode: r.deviceCode,
                  userCode: r.userCode,
                  verificationUri: r.verificationUri,
                  verificationUriComplete: r.verificationUriComplete,
                  expiresIn: r.expiresIn,
                  interval: r.interval,
                },
              }),
          }),
        );
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
    return Fx.run(
      Fx.from({
        ok: () => action(ctx, request),
        err: (error) => error,
      }).pipe(
        Fx.recover((error) => {
          if (isAuthError(error)) {
            return Fx.succeed(
              new Response(
                JSON.stringify({
                  code: error.data.code,
                  message: error.data.message,
                }),
                {
                  status: errorStatusCode,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          } else if (error instanceof ConvexError) {
            return Fx.succeed(
              new Response(null, {
                status: errorStatusCode,
                statusText:
                  typeof error.data === "string" ? error.data : "Error",
              }),
            );
          } else {
            logError(error);
            return Fx.succeed(
              new Response(null, {
                status: 500,
                statusText: "Internal Server Error",
              }),
            );
          }
        }),
      ),
    );
  };
}
function getCookies(request: Request): Record<string, string | undefined> {
  return parseCookies(request.headers.get("Cookie") ?? "");
}
