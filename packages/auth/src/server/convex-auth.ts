/**
 * The `ConvexAuth` class — a clean, class-based API that combines
 * authentication and portal admin functionality into a single export.
 *
 * Replaces the separate `Auth()` + `Portal()` factories with one class:
 *
 * ```ts
 * // convex/auth.ts
 * import { ConvexAuth, portalExports } from "@robelest/convex-auth/component";
 * import github from "@auth/core/providers/github";
 * import { components } from "./_generated/api";
 *
 * export const auth = new ConvexAuth(components.auth, {
 *   providers: [github],
 * });
 * export const { signIn, signOut, store } = auth;
 * export const { portalQuery, portalMutation, portalInternal } = portalExports(auth);
 * ```
 *
 * @module
 */

import {
  queryGeneric,
  mutationGeneric,
  internalMutationGeneric,
} from "convex/server";
import type { HttpRouter } from "convex/server";
import { v } from "convex/values";
import type { ComponentApi as AuthComponentApi } from "../component/_generated/component.js";
import { Auth } from "./implementation/index.js";
import type { ConvexAuthConfig } from "./types.js";
import { registerStaticRoutes } from "@convex-dev/self-hosting";
import { portalMagicLinkEmail } from "./portal-email.js";
import email from "../providers/email.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Config for the ConvexAuth class. Extends the standard auth config.
 *
 * Portal functionality (admin dashboard, magic link provider, static hosting)
 * is always available — no configuration flag needed. The portal UI works
 * when you export `portalQuery`, `portalMutation`, `portalInternal` from
 * your `convex/auth.ts` and upload the portal static files via CLI.
 */
export type ConvexAuthClassConfig = Omit<ConvexAuthConfig, "component">;

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
    throw new Error("Not authorized: portal admin access required");
  }
}

// ============================================================================
// ConvexAuth class
// ============================================================================

/**
 * Main entry point for Convex Auth. Instantiate with your component
 * reference and config to get all the exports you need.
 *
 * ```ts
 * export const auth = new ConvexAuth(components.auth, {
 *   providers: [github, resend({ ... })],
 * });
 * export const { signIn, signOut, store } = auth;
 * export const { portalQuery, portalMutation, portalInternal } = portalExports(auth);
 * ```
 */
export class ConvexAuth {
  /** The inner `auth` helper object from Auth() */
  private readonly _auth: ReturnType<typeof Auth>["auth"];
  /** The signIn action — export this from your convex/auth.ts */
  public readonly signIn: ReturnType<typeof Auth>["signIn"];
  /** The signOut action — export this from your convex/auth.ts */
  public readonly signOut: ReturnType<typeof Auth>["signOut"];
  /** The store internal mutation — export this from your convex/auth.ts */
  public readonly store: ReturnType<typeof Auth>["store"];

  /** @internal */
  readonly component: AuthComponentApi;
  /** @internal */
  readonly portalUrl: string;

  // ---- Proxied auth helper sub-objects ----
  /** User helpers: `.current(ctx)`, `.require(ctx)`, `.get(ctx, userId)`, `.viewer(ctx)` */
  get user() { return this._auth.user; }
  /** Session helpers */
  get session() { return this._auth.session; }
  /** Provider helpers */
  get provider() { return this._auth.provider; }
  /** Account helpers */
  get account() { return this._auth.account; }
  /** Group helpers */
  get group() { return this._auth.group; }
  /** Invite helpers */
  get invite() { return this._auth.invite; }
  /** Passkey helpers */
  get passkey() { return this._auth.passkey; }
  /** TOTP helpers */
  get totp() { return this._auth.totp; }

  constructor(component: AuthComponentApi, config: ConvexAuthClassConfig) {
    this.component = component;

    // Derive portal URL from CONVEX_SITE_URL
    this.portalUrl = process.env.CONVEX_SITE_URL
      ? `${process.env.CONVEX_SITE_URL.replace(/\/$/, "")}/auth`
      : "/auth";

    // Auto-register the `portal` email provider for magic link sign-in
    const providers = [...config.providers];
    providers.push(
      email({
        id: "portal",
        maxAge: 60 * 60 * 24, // 24 hours
        authorize: undefined, // Magic link — no email check needed
        async sendVerificationRequest({ identifier, url, expires }) {
          const hours = Math.max(
            1,
            Math.floor((+expires - Date.now()) / (60 * 60 * 1000)),
          );
          const html = portalMagicLinkEmail(url, hours);
          const siteUrl = process.env.CONVEX_SITE_URL;
          if (!siteUrl) {
            throw new Error(
              "CONVEX_SITE_URL is required to send portal magic link email",
            );
          }
          const response = await fetch(`${siteUrl}/auth-email-dispatch`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(process.env.AUTH_EMAIL_DISPATCH_SECRET
                ? {
                    "x-auth-email-dispatch-secret":
                      process.env.AUTH_EMAIL_DISPATCH_SECRET,
                  }
                : {}),
            },
            body: JSON.stringify({
              to: identifier,
              subject: "Sign in to Convex Auth Portal",
              html,
            }),
          });
          if (!response.ok) {
            throw new Error(
              `Could not send portal magic link email: ${response.status}`,
            );
          }
        },
      }),
    );

    // Initialize the core Auth() factory
    const authResult = Auth({
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
   * Register HTTP routes for OAuth, JWT well-known endpoints, and portal
   * static file serving.
   *
   * ```ts
   * // convex/http.ts
   * import { httpRouter } from "convex/server";
   * import { auth } from "./auth";
   *
   * const http = httpRouter();
   * auth.addHttpRoutes(http);
   * export default http;
   * ```
   */
  addHttpRoutes(
    http: HttpRouter,
    opts?: { pathPrefix?: string; spaFallback?: boolean },
  ): void {
    // Core auth routes (OAuth, JWKS, etc.)
    this._auth.addHttpRoutes(http);

    // Portal static file serving
    const prefix = opts?.pathPrefix ?? "/auth";

    // Create a shim that maps the self-hosting ComponentApi shape
    // to the auth component's portalBridge functions
    const selfHostingShim = {
      lib: {
        getByPath: this.component.portalBridge.getByPath,
        getCurrentDeployment: this.component.portalBridge.getCurrentDeployment,
        listAssets: this.component.portalBridge.listAssets,
        recordAsset: this.component.portalBridge.recordAsset,
        gcOldAssets: this.component.portalBridge.gcOldAssets,
        setCurrentDeployment: this.component.portalBridge.setCurrentDeployment,
        // generateUploadUrl is not needed — we use app storage directly
        generateUploadUrl: undefined as any,
      },
    };

    registerStaticRoutes(http, selfHostingShim as any, {
      pathPrefix: prefix,
      spaFallback: opts?.spaFallback ?? true,
    });
  }
}

// ============================================================================
// Portal exports (standalone function)
// ============================================================================

/**
 * Create portal function definitions from a ConvexAuth instance.
 *
 * This is a standalone function (not a class method) because Convex's
 * bundler can trace through `export const { x } = fn(instance)` but
 * cannot trace through `instance.method()`.
 *
 * ```ts
 * export const { portalQuery, portalMutation, portalInternal } = portalExports(auth);
 * ```
 */
export function portalExports(auth: ConvexAuth) {
  const authComponent = auth.component;
  const authHelper = (auth as any)._auth;
  const portalUrl = auth.portalUrl;

  const portalQuery = queryGeneric({
    args: {
      action: v.string(),
      userId: v.optional(v.string()),
    },
    handler: async (
      ctx: any,
      { action, userId }: { action: string; userId?: string },
    ) => {
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
        case "listUsers":
          return await ctx.runQuery(authComponent.public.userList);

        case "listSessions":
          return await ctx.runQuery(authComponent.public.sessionList);

        case "getUser":
          return await ctx.runQuery(authComponent.public.userGetById, {
            userId: userId!,
          });

        case "getUserSessions":
          return await ctx.runQuery(authComponent.public.sessionListByUser, {
            userId: userId!,
          });

        case "getUserAccounts": {
          const accounts = await ctx.runQuery(
            authComponent.public.accountListByUser,
            { userId: userId! },
          );
          // Strip secrets — never send password hashes to the frontend
          return accounts.map(({ secret: _, ...rest }: any) => rest);
        }

        // Invite validation (public within portal context)
        case "validateInvite": {
          // userId param repurposed as tokenHash for this action
          const tokenHash = userId;
          if (!tokenHash) throw new Error("tokenHash required");
          const invite = await ctx.runQuery(
            authComponent.public.inviteGetByTokenHash,
            { tokenHash },
          );
          if (!invite || invite.status !== "pending") {
            return null;
          }
          if (invite.expiresTime && invite.expiresTime < Date.now()) {
            return null;
          }
          return { _id: invite._id, role: invite.role };
        }

        case "getCurrentDeployment":
          return await ctx.runQuery(
            authComponent.portalBridge.getCurrentDeployment,
          );

        default:
          throw new Error(`Unknown portal query action: ${action}`);
      }
    },
  });

  const portalMutation = mutationGeneric({
    args: {
      action: v.string(),
      sessionId: v.optional(v.string()),
      tokenHash: v.optional(v.string()),
    },
    handler: async (
      ctx: any,
      {
        action,
        sessionId,
        tokenHash,
      }: { action: string; sessionId?: string; tokenHash?: string },
    ) => {
      const currentUserId = await authHelper.user.require(ctx);

      switch (action) {
        case "acceptInvite": {
          if (!tokenHash) throw new Error("tokenHash required");
          const invite = await ctx.runQuery(
            authComponent.public.inviteGetByTokenHash,
            { tokenHash },
          );
          if (!invite) throw new Error("Invalid invite token");
          if (invite.status !== "pending") {
            throw new Error(`Invite already ${invite.status}`);
          }
          if (invite.expiresTime && invite.expiresTime < Date.now()) {
            throw new Error("Invite has expired");
          }
          await ctx.runMutation(authComponent.public.inviteAccept, {
            inviteId: invite._id,
            acceptedByUserId: currentUserId,
          });
          return;
        }

        case "revokeSession": {
          await requirePortalAdmin(ctx, authComponent, currentUserId);
          await ctx.runMutation(authComponent.public.sessionDelete, {
            sessionId: sessionId!,
          });
          return;
        }

        default:
          throw new Error(`Unknown portal mutation action: ${action}`);
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
            authComponent.portalBridge.recordAsset,
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
            authComponent.portalBridge.gcOldAssets,
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
            authComponent.portalBridge.setCurrentDeployment,
            { deploymentId: args.currentDeploymentId },
          );
          return { deleted: storageIds.length, blobIds };
        }

        case "listAssets": {
          return await ctx.runQuery(authComponent.portalBridge.listAssets, {
            limit: args.limit,
          });
        }

        default:
          throw new Error(`Unknown portalInternal action: ${args.action}`);
      }
    },
  });

  return { portalQuery, portalMutation, portalInternal };
}
