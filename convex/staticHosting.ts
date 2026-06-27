/**
 * Upload + deployment API for the static-hosting component.
 *
 * These are internal functions, callable only via `npx convex run` or the
 * `static-hosting` CLI — they back the build/upload flow that ships the Svelte
 * SPA's static assets into the deployment so it's served from the site URL.
 *
 * @module
 */

import { exposeDeploymentQuery, exposeUploadApi } from "@convex-dev/static-hosting";

import { components } from "./_generated/api";

export const {
  generateUploadUrl,
  generateUploadUrls,
  recordAsset,
  recordAssets,
  gcOldAssets,
  listAssets,
} = exposeUploadApi(components.staticHosting);

export const { getCurrentDeployment } = exposeDeploymentQuery(components.staticHosting);
