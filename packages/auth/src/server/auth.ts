/**
 * The `Auth` class — the main entry point for Convex Auth.
 *
 * Combines authentication and portal admin functionality:
 *
 * ```ts
 * // convex/auth.ts
 * import { Auth, Portal } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const auth = new Auth(components.auth, {
 *   providers: [{ id: "google", type: "oauth" as const }],
 *   email: {
 *     from: "My App <noreply@example.com>",
 *     send: async (_ctx, { from, to, subject, html }) => {
 *       await fetch("https://api.resend.com/emails", {
 *         method: "POST",
 *         headers: {
 *           Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
 *           "Content-Type": "application/json",
 *         },
 *         body: JSON.stringify({ from, to, subject, html }),
 *       });
 *     },
 *   },
 * });
 * export const { signIn, signOut, store } = auth;
 * export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
 * ```
 *
 * @module
 */

import {
  queryGeneric,
  mutationGeneric,
  internalMutationGeneric,
  httpActionGeneric,
} from "convex/server";
import type { HttpRouter, UserIdentity } from "convex/server";
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import type { Doc } from "./implementation/types";
import type { ComponentApi as AuthComponentApi } from "../component/_generated/component";
import { Auth as AuthFactory } from "./implementation/index";
import type { ConvexAuthConfig } from "./types";
import { registerStaticRoutes } from "@convex-dev/self-hosting";
import { portalMagicLinkEmail } from "./templates";
import { defaultMagicLinkEmail } from "./templates";
import emailProvider from "../providers/email";
import { AUTH_VERSION } from "./version";
import { throwAuthError } from "./errors";

// ============================================================================
// Types
// ============================================================================

/**
 * Config for the Auth class. Extends the standard auth config
 * minus `component` (which is passed as the first constructor argument).
 *
 * When `email` is configured, the library auto-registers:
 * - A magic link provider (`id: "email"`) for user-facing sign-in
 * - A portal provider (`id: "portal"`) for admin dashboard sign-in
 *
 * Portal functionality is always available — no configuration flag
 * needed. The portal UI works when you export `portalQuery`,
 * `portalMutation`, `portalInternal` from your `convex/auth.ts`
 * and upload the portal static files via CLI.
 */
export type AuthClassConfig = Omit<ConvexAuthConfig, "component">;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if the authenticated user is a portal admin.
 * Uses the new index `roleAndStatusAndAcceptedByUserId` for efficient lookup.
 */
async function requirePortalAdmin(
  ctx: any,
  authComponent: AuthComponentApi,
  userId: string,
): Promise<void> {
  // Use inviteList with status filter, then check role + userId in-memory.
  // The new index makes the status filter efficient.
  const invites = await ctx.runQuery(authComponent.public.inviteList, {
    status: "accepted",
  });
  const isAdmin = invites.some(
    (invite: any) =>
      invite.role === "portalAdmin" && invite.acceptedByUserId === userId,
  );
  if (!isAdmin) {
    throwAuthError("PORTAL_NOT_AUTHORIZED");
  }
}

// ============================================================================
// Auth class
// ============================================================================

/**
 * Main entry point for Convex Auth. Instantiate with your component
 * reference and config to get all the exports you need.
 *
 * ```ts
 * export const auth = new Auth(components.auth, {
 *   providers: [google, password],
 *   email: {
 *     from: "My App <noreply@example.com>",
 *     send: (ctx, params) => resend.sendEmail(ctx, params),
 *   },
 * });
 * export const { signIn, signOut, store } = auth;
 * export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
 * ```
 */
export class Auth {
  /** The inner `auth` helper object from AuthFactory() */
  private readonly _auth: ReturnType<typeof AuthFactory>["auth"];
  /** The signIn action — export this from your convex/auth.ts */
  public readonly signIn: ReturnType<typeof AuthFactory>["signIn"];
  /** The signOut action — export this from your convex/auth.ts */
  public readonly signOut: ReturnType<typeof AuthFactory>["signOut"];
  /** The store internal mutation — export this from your convex/auth.ts */
  public readonly store: ReturnType<typeof AuthFactory>["store"];

  /** @internal */
  readonly component: AuthComponentApi;
  /** @internal */
  readonly portalUrl: string;

  // ---- Proxied auth helper sub-objects ----
  /** User helpers: `.current(ctx)`, `.require(ctx)`, `.get(ctx, userId)`, `.patch(ctx, userId, data)`, `.viewer(ctx)`, `.group.list(ctx, ...)`, `.group.get(ctx, ...)` */
  get user() { return this._auth.user; }
  /** Session helpers: `.current(ctx)`, `.invalidate(ctx, { userId, except? })` */
  get session() { return this._auth.session; }
  /** Provider helpers: `.signIn(ctx, provider, args)` */
  get provider() { return this._auth.provider; }
  /** Account helpers: `.create(ctx, args)`, `.get(ctx, args)`, `.updateCredentials(ctx, args)` */
  get account() { return this._auth.account; }
  /** Group helpers: `.create(ctx, ...)`, `.get(ctx, id)`, `.list(ctx, ...)`, `.update(ctx, ...)`, `.delete(ctx, id)`, `.member.*` */
  get group() { return this._auth.group; }
  /** Invite helpers: `.create(ctx, ...)`, `.get(ctx, id)`, `.getByTokenHash(ctx, hash)`, `.list(ctx, ...)`, `.accept(ctx, ...)`, `.revoke(ctx, id)` */
  get invite() { return this._auth.invite; }
  /** Passkey helpers: `.list(ctx, { userId })`, `.rename(ctx, id, name)`, `.remove(ctx, id)` */
  get passkey() { return this._auth.passkey; }
  /** TOTP helpers: `.list(ctx, { userId })`, `.remove(ctx, id)` */
  get totp() { return this._auth.totp; }
  /** API key helpers: `.create(ctx, ...)`, `.verify(ctx, rawKey)`, `.list(ctx, ...)`, `.get(ctx, id)`, `.update(ctx, ...)`, `.revoke(ctx, id)`, `.remove(ctx, id)` */
  get key() { return this._auth.key; }

  /**
   * @param component - The auth component reference from `components.auth`.
   * @param config - Auth configuration (providers, email transport, session, JWT, callbacks).
   */
  constructor(component: AuthComponentApi, config: AuthClassConfig) {
    this.component = component;

    // Derive portal URL from CONVEX_SITE_URL
    this.portalUrl = process.env.CONVEX_SITE_URL
      ? `${process.env.CONVEX_SITE_URL.replace(/\/$/, "")}/auth`
      : "/auth";

    const emailTransport = config.email;
    const providers = [...config.providers];

    // Auto-register user-facing magic link provider when email is configured.
    // Skipped if the user already registered their own provider with id "email".
    const hasUserEmailProvider = providers.some(
      (p) => typeof p === "object" && "id" in p && p.id === "email",
    );
    if (emailTransport && !hasUserEmailProvider) {
      providers.push(
        emailProvider({
          id: "email",
          maxAge: 60 * 60 * 24, // 24 hours
          authorize: undefined, // Magic link — no OTP email check needed
          async sendVerificationRequest({ identifier, url }, ctx) {
            if (!ctx) {
              throwAuthError("MISSING_ACTION_CONTEXT");
            }
            const { host } = new URL(url);
            await emailTransport.send(ctx, {
              from: emailTransport.from,
              to: identifier,
              subject: `Sign in to ${host}`,
              html: defaultMagicLinkEmail(url, host),
            });
          },
        }),
      );
    }

    // Auto-register portal admin magic link provider.
    // Uses its own styled dark-theme email template.
    providers.push(
      emailProvider({
        id: "portal",
        maxAge: 60 * 60 * 24, // 24 hours
        authorize: undefined, // Magic link — no OTP email check needed
        async sendVerificationRequest({ identifier, url, expires }, ctx) {
          if (!emailTransport) {
            throwAuthError("EMAIL_CONFIG_REQUIRED");
          }
          if (!ctx) {
            throwAuthError("MISSING_ACTION_CONTEXT");
          }

          // Check authorization BEFORE sending — only portal-authorized emails
          const invites = await ctx.runQuery(component.public.inviteList, {
            status: "accepted",
          });
          const hasAccess = invites.some(
            (invite: any) => invite.role === "portalAdmin" && invite.email === identifier,
          );
          if (!hasAccess) {
            throwAuthError("PORTAL_NOT_AUTHORIZED");
          }

          const hours = Math.max(
            1,
            Math.floor((+expires - Date.now()) / (60 * 60 * 1000)),
          );
          try {
            await emailTransport.send(ctx, {
              from: emailTransport.from,
              to: identifier,
              subject: "Sign in to Auth Portal",
              html: portalMagicLinkEmail(url, hours),
            });
          } catch (e: unknown) {
            throwAuthError(
              "EMAIL_SEND_FAILED",
              "Failed to send portal sign-in email.",
              { detail: e instanceof Error ? e.message : String(e) },
            );
          }
        },
      }),
    );

    // Initialize the core AuthFactory()
    const authResult = AuthFactory({
      ...config,
      component,
      providers,
    });

    this._auth = authResult.auth;
    this.signIn = authResult.signIn;
    this.signOut = authResult.signOut;
    this.store = authResult.store;

  }

  /**
   * HTTP namespace — route registration, Bearer-authenticated endpoints,
   * and portal static file serving.
   *
   * ```ts
   * // convex/http.ts
   * import { httpRouter } from "convex/server";
   * import { auth } from "./auth";
   *
   * const http = httpRouter();
   * auth.http.add(http);
   * export default http;
   * ```
   */
  get http() {
    // Cache the object so repeated access returns the same reference
    const inner = this._auth.http;
    const component = this.component;

    return {
      ...inner,

      /**
       * Register core HTTP routes (OAuth, JWKS) **and** portal static file
       * serving in one call.
       *
       * @param http - The Convex HTTP router to register routes on.
       * @param opts.pathPrefix - URL prefix for portal static files. Defaults to `"/auth"`.
       * @param opts.spaFallback - Serve `index.html` for unmatched sub-paths. Defaults to `true`.
       */
      add(
        http: HttpRouter,
        opts?: { pathPrefix?: string; spaFallback?: boolean },
      ): void {
        // Core auth routes (OAuth, JWKS, etc.)
        inner.add(http);

        const prefix = opts?.pathPrefix ?? "/auth";

        // Portal configuration endpoint — serves Convex URLs + version info.
        // The portal SPA fetches this at startup to discover its Convex backend,
        // which is critical for custom domain deployments where the hostname
        // alone doesn't reveal the Convex cloud URL.
        // Registered as an exact path match before the static file prefix catch-all.
        http.route({
          path: `${prefix}/.well-known/portal-config`,
          method: "GET",
          handler: httpActionGeneric(async () => {
            return new Response(
              JSON.stringify({
                convexUrl: process.env.CONVEX_CLOUD_URL,
                siteUrl: process.env.CONVEX_SITE_URL,
                version: AUTH_VERSION,
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control":
                    "public, max-age=60, stale-while-revalidate=60",
                  "Access-Control-Allow-Origin": "*",
                },
              },
            );
          }),
        });

        // Create a shim that maps the self-hosting ComponentApi shape
        // to the auth component's bridge functions
        const selfHostingShim = {
          lib: {
            getByPath: component.bridge.getByPath,
            getCurrentDeployment: component.bridge.getCurrentDeployment,
            listAssets: component.bridge.listAssets,
            recordAsset: component.bridge.recordAsset,
            gcOldAssets: component.bridge.gcOldAssets,
            setCurrentDeployment: component.bridge.setCurrentDeployment,
            // generateUploadUrl is not needed — we use app storage directly
            generateUploadUrl: undefined as any,
          },
        };

        registerStaticRoutes(http, selfHostingShim as any, {
          pathPrefix: prefix,
          spaFallback: opts?.spaFallback ?? true,
        });
      },
    };
  }
}

// ============================================================================
// Portal exports (standalone function)
// ============================================================================

/**
 * Create portal function definitions from an `Auth` instance.
 *
 * Standalone function (not a class method) because Convex's bundler
 * can trace `export const { x } = fn(instance)` but not `instance.method()`.
 *
 * ```ts
 * export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
 * ```
 *
 * @param auth - The `Auth` class instance from your `convex/auth.ts`.
 * @returns `{ portalQuery, portalMutation, portalInternal }` — export all three.
 */
export function Portal(auth: Auth) {
  const authComponent = auth.component;
  const authHelper = (auth as any)._auth;
  const portalUrl = auth.portalUrl;

  const portalQuery = queryGeneric({
    args: {
      action: v.string(),
      userId: v.optional(v.string()),
      // Group query params
      groupId: v.optional(v.string()),
      groupType: v.optional(v.string()),
      groupParentId: v.optional(v.string()),
    },
    handler: async (
      ctx: any,
      args: {
        action: string;
        userId?: string;
        groupId?: string;
        groupType?: string;
        groupParentId?: string;
      },
    ) => {
      const { action, userId } = args;
      const currentUserId = await authHelper.user.require(ctx);

      // Allow isAdmin check without admin requirement
      if (action === "isAdmin") {
        try {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          return true;
        } catch {
          return false;
        }
      }

      await requirePortalAdmin(ctx, authComponent, currentUserId);

      switch (action) {
        // ---- Admin-only bulk listing (no public API) ----
        case "listUsers": {
          const { items } = await ctx.runQuery(authComponent.public.userList, {});
          return items;
        }

        case "listSessions": {
          const { items } = await ctx.runQuery(authComponent.public.sessionList, {});
          return items;
        }

        case "listKeys": {
          const { items } = await ctx.runQuery(authComponent.public.keyList, {});
          return items;
        }

        case "getCurrentDeployment":
          return await ctx.runQuery(
            authComponent.bridge.getCurrentDeployment,
          );

        // ---- User queries (public auth API) ----
        case "getUser":
          return await authHelper.user.get(ctx, userId!);

        case "getUserSessions":
          return await ctx.runQuery(authComponent.public.sessionListByUser, {
            userId: userId!,
          });
          // sessionListByUser is a legacy query that returns a raw array

        case "getUserAccounts": {
          const accounts = await ctx.runQuery(
            authComponent.public.accountListByUser,
            { userId: userId! },
          );
          // Strip secrets — never send password hashes to the frontend
          return accounts.map(({ secret: _, ...rest }: any) => rest);
        }

        case "getUserKeys": {
          const { items: keys } = await authHelper.key.list(ctx, { where: { userId: userId! } });
          return keys;
        }

        case "getUserGroups": {
          const { items: memberships } = await authHelper.user.group.list(ctx, { userId: userId! });
          // Resolve group details for each membership
          const groups = await Promise.all(
            memberships.map(async (m: any) => {
              const group = await authHelper.group.get(ctx, m.groupId);
              return { ...m, group: group ?? null };
            }),
          );
          return groups;
        }

        // ---- Key queries (public auth API) ----
        case "getKey":
          return await authHelper.key.get(ctx, userId!); // userId param repurposed as keyId

        // ---- Group queries (public auth API) ----
        case "listGroups": {
          const { items: groups } = await authHelper.group.list(ctx, {
            where: {
              type: args.groupType,
              parentGroupId: args.groupParentId,
            },
          });
          return groups;
        }

        case "getGroup":
          return await authHelper.group.get(ctx, args.groupId!);

        case "getGroupMembers": {
          const { items: members } = await authHelper.group.member.list(ctx, {
            where: { groupId: args.groupId! },
          });
          return members;
        }

        case "getGroupInvites": {
          const { items: invites } = await authHelper.invite.list(ctx, {
            where: { groupId: args.groupId! },
          });
          return invites;
        }

        // ---- Invite validation (portal context) ----
        case "validateInvite": {
          // userId param repurposed as tokenHash for this action
          const tokenHash = userId;
          if (!tokenHash) throwAuthError("INVITE_TOKEN_REQUIRED");
          const invite = await authHelper.invite.getByTokenHash(ctx, tokenHash);
          if (!invite || invite.status !== "pending") {
            return null;
          }
          if (invite.expiresTime && invite.expiresTime < Date.now()) {
            return null;
          }
          return { _id: invite._id, role: invite.role };
        }

        default:
          throwAuthError("PORTAL_UNKNOWN_ACTION", `Unknown portal query action: ${action}`);
      }
    },
  });

  const portalMutation = mutationGeneric({
    args: {
      action: v.string(),
      sessionId: v.optional(v.string()),
      tokenHash: v.optional(v.string()),
      // API key fields
      keyId: v.optional(v.string()),
      keyUserId: v.optional(v.string()),
      keyName: v.optional(v.string()),
      keyScopes: v.optional(
        v.array(
          v.object({
            resource: v.string(),
            actions: v.array(v.string()),
          }),
        ),
      ),
      keyRateLimit: v.optional(
        v.object({
          maxRequests: v.number(),
          windowMs: v.number(),
        }),
      ),
      keyExpiresAt: v.optional(v.number()),
      // Group mutation fields
      groupId: v.optional(v.string()),
      groupName: v.optional(v.string()),
      groupSlug: v.optional(v.string()),
      groupType: v.optional(v.string()),
      groupParentId: v.optional(v.string()),
      groupExtend: v.optional(v.any()),
      memberId: v.optional(v.string()),
      memberUserId: v.optional(v.string()),
      memberRole: v.optional(v.string()),
      memberStatus: v.optional(v.string()),
    },
    handler: async (ctx: any, args: any) => {
      const currentUserId = await authHelper.user.require(ctx);

      switch (args.action) {
        case "acceptInvite": {
          if (!args.tokenHash) throwAuthError("INVITE_TOKEN_REQUIRED");
          const invite = await authHelper.invite.getByTokenHash(ctx, args.tokenHash);
          if (!invite) throwAuthError("INVALID_INVITE");
          if (invite.status !== "pending") {
            throwAuthError("INVITE_ALREADY_USED", `Invite already ${invite.status}`);
          }
          if (invite.expiresTime && invite.expiresTime < Date.now()) {
            throwAuthError("INVITE_EXPIRED");
          }
          await authHelper.invite.accept(ctx, invite._id, currentUserId);
          return;
        }

        // ---- Admin-only (no public API for session delete) ----
        case "revokeSession": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          await ctx.runMutation(authComponent.public.sessionDelete, {
            sessionId: args.sessionId!,
          });
          return;
        }

        // ---- API Keys (public auth API) ----
        case "createKey": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          return await authHelper.key.create(ctx, {
            userId: args.keyUserId!,
            name: args.keyName!,
            scopes: args.keyScopes ?? [],
            rateLimit: args.keyRateLimit,
            expiresAt: args.keyExpiresAt,
          });
        }

        case "revokeKey": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          await authHelper.key.revoke(ctx, args.keyId!);
          return;
        }

        case "deleteKey": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          await authHelper.key.remove(ctx, args.keyId!);
          return;
        }

        case "updateKey": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          const data: Record<string, any> = {};
          if (args.keyName) data.name = args.keyName;
          if (args.keyScopes) data.scopes = args.keyScopes;
          if (args.keyRateLimit) data.rateLimit = args.keyRateLimit;
          await authHelper.key.update(ctx, args.keyId!, data);
          return;
        }

        // ---- Groups (public auth API) ----
        case "createGroup": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          const groupData: Record<string, any> = { name: args.groupName! };
          if (args.groupSlug) groupData.slug = args.groupSlug;
          if (args.groupType) groupData.type = args.groupType;
          if (args.groupParentId) groupData.parentGroupId = args.groupParentId;
          if (args.groupExtend) groupData.extend = args.groupExtend;
          return await authHelper.group.create(ctx, groupData);
        }

        case "updateGroup": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          const updateData: Record<string, any> = {};
          if (args.groupName) updateData.name = args.groupName;
          if (args.groupSlug !== undefined) updateData.slug = args.groupSlug;
          if (args.groupType !== undefined) updateData.type = args.groupType;
          await authHelper.group.update(ctx, args.groupId!, updateData);
          return;
        }

        case "deleteGroup": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          await authHelper.group.delete(ctx, args.groupId!);
          return;
        }

        case "addGroupMember": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          return await authHelper.group.member.add(ctx, {
            groupId: args.groupId!,
            userId: args.memberUserId!,
            role: args.memberRole,
            status: args.memberStatus,
          });
        }

        case "removeGroupMember": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          await authHelper.group.member.remove(ctx, args.memberId!);
          return;
        }

        case "updateGroupMember": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          const memberData: Record<string, any> = {};
          if (args.memberRole !== undefined) memberData.role = args.memberRole;
          if (args.memberStatus !== undefined) memberData.status = args.memberStatus;
          await authHelper.group.member.update(ctx, args.memberId!, memberData);
          return;
        }

        default:
          throwAuthError("PORTAL_UNKNOWN_ACTION", `Unknown portal mutation action: ${args.action}`);
      }
    },
  });

  const portalInternal = internalMutationGeneric({
    args: {
      action: v.string(),
      tokenHash: v.optional(v.string()),
      path: v.optional(v.string()),
      storageId: v.optional(v.string()),
      blobId: v.optional(v.string()),
      contentType: v.optional(v.string()),
      deploymentId: v.optional(v.string()),
      currentDeploymentId: v.optional(v.string()),
      limit: v.optional(v.number()),
    },
    handler: async (ctx: any, args: any) => {
      switch (args.action) {
        // ---- Invite management (CLI) ----
        case "createPortalInvite": {
          await ctx.runMutation(authComponent.public.inviteCreate, {
            tokenHash: args.tokenHash,
            role: "portalAdmin",
            status: "pending" as const,
          });
          return { portalUrl };
        }

        // ---- Static hosting (CLI upload) ----
        case "generateUploadUrl": {
          return await ctx.storage.generateUploadUrl();
        }

        case "recordAsset": {
          const { oldStorageId, oldBlobId } = await ctx.runMutation(
            authComponent.bridge.recordAsset,
            {
              path: args.path,
              ...(args.storageId ? { storageId: args.storageId } : {}),
              ...(args.blobId ? { blobId: args.blobId } : {}),
              contentType: args.contentType,
              deploymentId: args.deploymentId,
            },
          );
          if (oldStorageId) {
            try {
              await ctx.storage.delete(oldStorageId);
            } catch {
              // Ignore — old file may have been in different storage
            }
          }
          return oldBlobId ?? null;
        }

        case "gcOldAssets": {
          const { storageIds, blobIds } = await ctx.runMutation(
            authComponent.bridge.gcOldAssets,
            { currentDeploymentId: args.currentDeploymentId },
          );
          for (const storageId of storageIds) {
            try {
              await ctx.storage.delete(storageId);
            } catch {
              // Ignore
            }
          }
          await ctx.runMutation(
            authComponent.bridge.setCurrentDeployment,
            { deploymentId: args.currentDeploymentId },
          );
          return { deleted: storageIds.length, blobIds };
        }

        case "listAssets": {
          return await ctx.runQuery(authComponent.bridge.listAssets, {
            limit: args.limit,
          });
        }

        default:
          throwAuthError("PORTAL_UNKNOWN_ACTION", `Unknown portalInternal action: ${args.action}`);
      }
    },
  });

  return { portalQuery, portalMutation, portalInternal };
}

// ============================================================================
// AuthCtx — ctx enrichment for customQuery / customMutation
// ============================================================================

/**
 * The shape of a user document from the auth component's `user` table.
 *
 * Includes system fields (`_id`, `_creationTime`) plus the schema fields
 * (`name`, `email`, `image`, `extend`, etc.).
 */
export type UserDoc = Doc<"user">;

/**
 * Configuration for auth context enrichment.
 *
 * @typeParam TResolve - The shape returned by the `resolve` callback.
 *   Inferred automatically — you usually don't need to supply this manually.
 */
export type AuthCtxConfig<
  TResolve extends Record<string, unknown> = Record<string, never>,
> = {
  /**
   * When `true`, unauthenticated requests set `ctx.auth.userId` and
   * `ctx.auth.user` to `null` instead of throwing.
   *
   * @default false
   */
  optional?: boolean;
  /**
   * Resolve additional context after authentication succeeds (e.g.
   * group/role for multi-tenant apps). The returned object is spread
   * into `ctx.auth`.
   */
  resolve?: (
    ctx: any,
    user: UserDoc,
  ) => Promise<TResolve> | TResolve;
};

/**
 * Create a `convex-helpers`–compatible customization object that
 * enriches `ctx.auth` with the authenticated user's data.
 *
 * Standalone function (not a class method) because Convex's bundler
 * can trace `export const x = fn(instance)` but not `instance.method()`.
 *
 * ### Basic usage (with `convex-helpers`)
 *
 * ```ts
 * // convex/functions.ts
 * import { customQuery, customMutation } from "convex-helpers/server/customFunctions";
 * import { query as rawQuery, mutation as rawMutation } from "./_generated/server";
 * import { AuthCtx } from "\@robelest/convex-auth/component";
 * import { auth } from "./auth";
 *
 * const authCtx = AuthCtx(auth);
 *
 * export const query = customQuery(rawQuery, authCtx);
 * export const mutation = customMutation(rawMutation, authCtx);
 * ```
 *
 * Then in any function file:
 *
 * ```ts
 * // convex/messages.ts
 * import { query, mutation } from "./functions";
 *
 * export const list = query({
 *   args: {},
 *   handler: async (ctx) => {
 *     // ctx.auth.userId and ctx.auth.user are already resolved
 *     return ctx.db.query("messages").collect();
 *   },
 * });
 * ```
 *
 * ### Optional auth (public routes)
 *
 * ```ts
 * export const publicQuery = customQuery(rawQuery, AuthCtx(auth, { optional: true }));
 * // ctx.auth.userId is null when unauthenticated
 * ```
 *
 * ### Multi-tenant with group resolution
 *
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   resolve: async (ctx, user) => {
 *     const groupId = user?.extend?.lastActiveGroup;
 *     const membership = await auth.user.group.get(ctx, {
 *       userId: user._id,
 *       groupId,
 *     });
 *     return { groupId, role: membership?.role ?? "member" };
 *   },
 * });
 * // ctx.auth.groupId and ctx.auth.role available in handlers
 * ```
 *
 * @param auth - The `Auth` class instance from your `convex/auth.ts`.
 * @param config - Optional configuration for optional auth and group resolution.
 * @returns A `{ args, input }` customization object compatible with
 *          `customQuery` / `customMutation` from `convex-helpers`.
 */
/**
 * Overload: optional auth — `userId` and `user` may be `null`.
 */
export function AuthCtx<
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: Auth,
  config: AuthCtxConfig<TResolve> & { optional: true },
): {
  args: {};
  input: (
    ctx: any,
    _args: any,
    _extra?: any,
  ) => Promise<{
    ctx: {
      auth: {
        getUserIdentity: () => Promise<UserIdentity | null>;
        userId: GenericId<"user"> | null;
        user: UserDoc | null;
      } & TResolve;
    };
    args: {};
  }>;
};
/**
 * Overload: required auth (default) — `userId` and `user` are never `null`.
 */
export function AuthCtx<
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: Auth,
  config?: AuthCtxConfig<TResolve>,
): {
  args: {};
  input: (
    ctx: any,
    _args: any,
    _extra?: any,
  ) => Promise<{
    ctx: {
      auth: {
        getUserIdentity: () => Promise<UserIdentity | null>;
        userId: GenericId<"user">;
        user: UserDoc;
      } & TResolve;
    };
    args: {};
  }>;
};
// Implementation
export function AuthCtx(auth: Auth, config?: AuthCtxConfig<any>) {
  const authHelper = (auth as any)._auth;

  return {
    args: {},
    input: async (ctx: any, _args: any, _extra?: any) => {
      const nativeAuth = ctx.auth;

      if (config?.optional) {
        const userId = await authHelper.user.current(ctx);
        if (!userId) {
          return {
            ctx: {
              auth: {
                getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
                userId: null,
                user: null,
              },
            },
            args: {},
          };
        }
        const user = await authHelper.user.get(ctx, userId);
        const extra = config.resolve
          ? await config.resolve(ctx, user)
          : {};
        return {
          ctx: {
            auth: {
              getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
              userId,
              user,
              ...extra,
            },
          },
          args: {},
        };
      }

      // Required mode (default): throws NOT_SIGNED_IN
      const userId = await authHelper.user.require(ctx);
      const user = await authHelper.user.get(ctx, userId);
      const extra = config?.resolve
        ? await config.resolve(ctx, user)
        : {};

      return {
        ctx: {
          auth: {
            getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
            userId,
            user,
            ...extra,
          },
        },
        args: {},
      };
    },
  };
}

/**
 * Extract the `ctx.auth` shape from an {@link AuthCtx} result.
 *
 * Follows the same pattern as `Infer<typeof validator>` in Convex
 * and `z.infer<typeof schema>` in Zod.
 *
 * @example
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   resolve: async (ctx, user) => ({ groupId: "abc", role: "admin" }),
 * });
 * type MyAuth = InferAuth<typeof authCtx>;
 * // { getUserIdentity, userId, user, groupId: string, role: string }
 * ```
 */
export type InferAuth<
  T extends { input: (...args: any[]) => Promise<{ ctx: { auth: any } }> },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];
