/**
 * Bridge functions that delegate to the self-hosting sub-component.
 *
 * The auth component uses self-hosting as a sub-component for serving
 * portal static assets. These functions expose the self-hosting API
 * as internal queries/mutations within the auth component, so the
 * app layer can call them via `ctx.runQuery(components.auth.portalBridge.getByPath, ...)`.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";

// ============================================================================
// Queries — delegate to selfHosting.lib.*
// ============================================================================

/**
 * Look up a static asset by URL path.
 * Delegates to selfHosting.lib.getByPath.
 */
export const getByPath = query({
  args: { path: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.selfHosting.lib.getByPath, {
      path: args.path,
    });
  },
});

/**
 * Get the current deployment info.
 * Delegates to selfHosting.lib.getCurrentDeployment.
 */
export const getCurrentDeployment = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.runQuery(
      components.selfHosting.lib.getCurrentDeployment,
      {},
    );
  },
});

/**
 * List all static assets.
 * Delegates to selfHosting.lib.listAssets.
 */
export const listAssets = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.selfHosting.lib.listAssets, {
      limit: args.limit,
    });
  },
});

// ============================================================================
// Mutations — delegate to selfHosting.lib.*
// ============================================================================

/**
 * Record an asset after upload.
 * Delegates to selfHosting.lib.recordAsset.
 */
export const recordAsset = mutation({
  args: {
    path: v.string(),
    storageId: v.optional(v.string()),
    blobId: v.optional(v.string()),
    contentType: v.string(),
    deploymentId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.selfHosting.lib.recordAsset, {
      path: args.path,
      ...(args.storageId ? { storageId: args.storageId } : {}),
      ...(args.blobId ? { blobId: args.blobId } : {}),
      contentType: args.contentType,
      deploymentId: args.deploymentId,
    });
  },
});

/**
 * Garbage collect assets from old deployments.
 * Delegates to selfHosting.lib.gcOldAssets.
 */
export const gcOldAssets = mutation({
  args: { currentDeploymentId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.selfHosting.lib.gcOldAssets, {
      currentDeploymentId: args.currentDeploymentId,
    });
  },
});

/**
 * Update the current deployment ID.
 * Delegates to selfHosting.lib.setCurrentDeployment.
 */
export const setCurrentDeployment = mutation({
  args: { deploymentId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      components.selfHosting.lib.setCurrentDeployment,
      { deploymentId: args.deploymentId },
    );
  },
});
