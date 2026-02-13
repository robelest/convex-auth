import {
  queryGeneric,
  mutationGeneric,
  internalMutationGeneric,
} from "convex/server";
import type { HttpRouter } from "convex/server";
import { v } from "convex/values";
import type { ComponentApi as AuthComponentApi } from "../component/_generated/component.js";
import { registerStaticRoutes } from "@convex-dev/self-hosting";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if the authenticated user is a portal admin.
 * Portal admins are identified by having an accepted invite
 * with `role: "portalAdmin"`.
 */
async function requirePortalAdmin(
  ctx: any,
  authComponent: AuthComponentApi,
  userId: string,
): Promise<void> {
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
// Portal() factory
// ============================================================================

/**
 * Configure the Convex Auth Portal. Returns all the functions needed to
 * serve the portal admin UI, manage invite links, and query auth data.
 *
 * The portal dogfoods the same `Auth()` instance as your app. Portal admins
 * sign in via email magic link and are identified by accepted invites with
 * `role: "portalAdmin"`.
 *
 * ```ts filename="convex/portal.ts"
 * import { Portal } from "@robelest/convex-auth/component";
 * import { auth } from "./auth";
 * import { components } from "./_generated/api";
 *
 * export const {
 *   hosting, getCurrentDeployment,
 *   portalQuery, portalMutation,
 *   validateInvite, acceptInvite, createPortalInvite,
 *   portal,
 * } = Portal(components.auth, components.selfHosting, auth);
 * ```
 *
 * ## Setup
 *
 * 1. Configure an email provider in your `Auth()` config (e.g. Resend).
 * 2. Generate an admin invite link:
 *    `npx @robelest/convex-auth portal link [--prod]`
 * 3. Visit the link, enter your email, click the magic link, and you're in.
 *
 * The portal URL is auto-derived from `CONVEX_SITE_URL` (always set by Convex).
 * Override with `options.portalUrl` if you need a custom URL.
 */
export function Portal(
  authComponent: AuthComponentApi,
  selfHostingComponent: any,
  auth: any,
  options?: { portalUrl?: string },
) {
  const portalUrl =
    options?.portalUrl ??
    (process.env.CONVEX_SITE_URL
      ? `${process.env.CONVEX_SITE_URL.replace(/\/$/, "")}/portal`
      : "/portal");

  return {
    // ---- Self-hosting: combined internal mutation for CLI ----

    /**
     * Combined internal mutation for self-hosting operations.
     * Used by the CLI (`@robelest/convex-auth portal upload`) to
     * upload static assets and manage deployments.
     */
    hosting: internalMutationGeneric({
      args: {
        action: v.string(),
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
          case "generateUploadUrl": {
            return await ctx.storage.generateUploadUrl();
          }

          case "recordAsset": {
            const { oldStorageId, oldBlobId } = await ctx.runMutation(
              selfHostingComponent.lib.recordAsset,
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
              selfHostingComponent.lib.gcOldAssets,
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
              selfHostingComponent.lib.setCurrentDeployment,
              { deploymentId: args.currentDeploymentId },
            );
            return { deleted: storageIds.length, blobIds };
          }

          case "listAssets": {
            return await ctx.runQuery(selfHostingComponent.lib.listAssets, {
              limit: args.limit,
            });
          }

          default:
            throw new Error(`Unknown hosting action: ${args.action}`);
        }
      },
    }),

    // ---- Deployment query (public, for client live-reload) ----

    getCurrentDeployment: queryGeneric({
      args: {},
      handler: async (ctx: any) => {
        return await ctx.runQuery(
          selfHostingComponent.lib.getCurrentDeployment,
          {},
        );
      },
    }),

    // ---- Invite management ----

    /**
     * Validate an invite token. Returns the invite if valid and pending,
     * or `null` otherwise. Used by the portal UI to check if an invite
     * link is valid before showing the registration form.
     */
    validateInvite: queryGeneric({
      args: { tokenHash: v.string() },
      handler: async (ctx: any, { tokenHash }: { tokenHash: string }) => {
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
      },
    }),

    /**
     * Accept a portal invite. Must be called by an authenticated user.
     * Marks the invite as accepted and records the accepting user's ID.
     *
     * The portal UI calls this after the user has signed in via magic link
     * following an invite link.
     */
    acceptInvite: mutationGeneric({
      args: { tokenHash: v.string() },
      handler: async (ctx: any, { tokenHash }: { tokenHash: string }) => {
        const userId = await auth.user.require(ctx);

        const invite = await ctx.runQuery(
          authComponent.public.inviteGetByTokenHash,
          { tokenHash },
        );
        if (!invite) {
          throw new Error("Invalid invite token");
        }
        if (invite.status !== "pending") {
          throw new Error(`Invite already ${invite.status}`);
        }
        if (invite.expiresTime && invite.expiresTime < Date.now()) {
          throw new Error("Invite has expired");
        }

        await ctx.runMutation(authComponent.public.inviteAccept, {
          inviteId: invite._id,
          acceptedByUserId: userId,
        });
      },
    }),

    /**
     * Create a portal admin invite. Internal mutation called by the CLI
     * (`npx @robelest/convex-auth portal link`).
     */
    createPortalInvite: internalMutationGeneric({
      args: { tokenHash: v.string() },
      handler: async (ctx: any, { tokenHash }: { tokenHash: string }) => {
        await ctx.runMutation(authComponent.public.inviteCreate, {
          tokenHash,
          role: "portalAdmin",
          status: "pending" as const,
        });
        return { portalUrl };
      },
    }),

    // ---- Portal data query (auth-gated) ----

    /**
     * Combined portal query for all auth data reads.
     * Requires the caller to be an authenticated portal admin.
     *
     * Actions:
     * - `listUsers` — List all users
     * - `listSessions` — List all sessions
     * - `getUser` — Get a single user by ID (requires `userId`)
     * - `getUserSessions` — List sessions for a user (requires `userId`)
     * - `getUserAccounts` — List auth accounts for a user (requires `userId`)
     * - `isAdmin` — Check if the current user is a portal admin
     */
    portalQuery: queryGeneric({
      args: {
        action: v.string(),
        userId: v.optional(v.string()),
      },
      handler: async (
        ctx: any,
        { action, userId }: { action: string; userId?: string },
      ) => {
        const currentUserId = await auth.user.require(ctx);

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

          default:
            throw new Error(`Unknown portal query action: ${action}`);
        }
      },
    }),

    // ---- Portal mutation (auth-gated) ----

    /**
     * Combined portal mutation for all auth data writes.
     * Requires the caller to be an authenticated portal admin.
     *
     * Actions:
     * - `revokeSession` — Revoke (delete) a session (requires `sessionId`)
     */
    portalMutation: mutationGeneric({
      args: {
        action: v.string(),
        sessionId: v.optional(v.string()),
      },
      handler: async (
        ctx: any,
        { action, sessionId }: { action: string; sessionId?: string },
      ) => {
        const currentUserId = await auth.user.require(ctx);
        await requirePortalAdmin(ctx, authComponent, currentUserId);

        switch (action) {
          case "revokeSession":
            await ctx.runMutation(authComponent.public.sessionDelete, {
              sessionId: sessionId!,
            });
            return;

          default:
            throw new Error(`Unknown portal mutation action: ${action}`);
        }
      },
    }),

    // ---- Portal namespace ----

    portal: {
      /**
       * The URL where the portal is served. Used by the Svelte client
       * as the `redirectTo` for magic link sign-in.
       */
      portalUrl,

      /**
       * Register HTTP routes that serve the portal static UI.
       */
      addHttpRoutes: (
        http: HttpRouter,
        opts?: { pathPrefix?: string; spaFallback?: boolean },
      ) => {
        const prefix = opts?.pathPrefix ?? "/portal";

        // Static file serving
        registerStaticRoutes(http, selfHostingComponent, {
          pathPrefix: prefix,
          spaFallback: opts?.spaFallback ?? true,
        });
      },
    },
  };
}
