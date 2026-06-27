/**
 * Component-internal data migrations, run via the `@convex-dev/migrations`
 * component mounted in `convex.config.ts`.
 *
 * The auth component owns its own tables, so migrations over them must run
 * *inside* the component. Consumers trigger a migration after upgrading:
 *
 * ```sh
 * npx convex run auth/migrations:runDropHasTotp '{}'
 * ```
 *
 * @module
 */

import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/** Migrations registry over the component's own `DataModel`. */
export const migrations = new Migrations<DataModel>(components.migrations, {
  internalMutation,
});

/**
 * Strip the deprecated denormalized `User.hasTotp` cache from every row.
 *
 * The field was removed from the typed surface; this clears it from
 * pre-existing data so it can eventually be dropped from the schema.
 * Idempotent — rows without the field are skipped.
 */
export const dropHasTotp = migrations.define({
  table: "User",
  migrateOne: (_ctx, doc) =>
    (doc as { hasTotp?: boolean }).hasTotp === undefined ? undefined : { hasTotp: undefined },
});

/** CLI/dashboard runner: `npx convex run auth/migrations:runDropHasTotp`. */
export const runDropHasTotp = migrations.runner(internal.migrations.dropHasTotp);

/**
 * Backfill `OAuthClient.tokenEndpointAuthMethod` on pre-existing rows so the
 * token endpoint can drive client authentication from the stored method rather
 * than the legacy "a secret hash exists" inference. A row with a secret becomes
 * `client_secret_post` (the historical DCR default); one without becomes `none`
 * (it was only ever authenticatable by PKCE). Idempotent — rows already
 * carrying a method are skipped.
 */
export const backfillOAuthClientAuthMethod = migrations.define({
  table: "OAuthClient",
  migrateOne: (_ctx, doc) =>
    doc.tokenEndpointAuthMethod !== undefined
      ? undefined
      : {
          tokenEndpointAuthMethod: doc.clientSecretHash
            ? ("client_secret_post" as const)
            : ("none" as const),
        },
});

/** CLI/dashboard runner: `npx convex run auth/migrations:runBackfillOAuthClientAuthMethod`. */
export const runBackfillOAuthClientAuthMethod = migrations.runner(
  internal.migrations.backfillOAuthClientAuthMethod,
);

/**
 * Backfill renamed connection/SCIM auth-event kinds on persisted rows.
 *
 * Two breaking renames landed on the event vocabulary:
 * - protocol-config events `connection.{saml,oidc}.configured` /
 *   `scim.configured` → `.set` (mirroring the `auth.connection.*.set` facade);
 * - SCIM events `scim.*` gained the `connection.` namespace prefix
 *   (`scim.user.provisioned` → `connection.scim.user.provisioned`).
 *
 * Stored `kind` lives on three tables: the `AuthEventProjection` log, the
 * `GroupWebhookEndpoint.subscriptions` array, and `GroupWebhookDelivery` rows.
 * The `category` column is unchanged — SCIM events keep `category: "scim"`.
 * Idempotent: rows already on a new kind are not in the map and are skipped.
 */
const CONNECTION_EVENT_KIND_RENAMES: Record<string, string> = {
  "connection.saml.configured": "connection.saml.set",
  "connection.oidc.configured": "connection.oidc.set",
  "scim.configured": "connection.scim.set",
  "scim.read": "connection.scim.read",
  "scim.user.provisioned": "connection.scim.user.provisioned",
  "scim.user.updated": "connection.scim.user.updated",
  "scim.user.deactivated": "connection.scim.user.deactivated",
  "scim.user.reactivated": "connection.scim.user.reactivated",
  "scim.group.provisioned": "connection.scim.group.provisioned",
  "scim.group.updated": "connection.scim.group.updated",
  "scim.group.deactivated": "connection.scim.group.deactivated",
  "scim.group.reactivated": "connection.scim.group.reactivated",
};

/** Rewrite renamed connection/SCIM `kind` values on `AuthEventProjection` rows. */
export const renameAuthEventProjectionKinds = migrations.define({
  table: "AuthEventProjection",
  migrateOne: (_ctx, doc) => {
    const next = CONNECTION_EVENT_KIND_RENAMES[doc.kind as string];
    return next === undefined ? undefined : { kind: next as typeof doc.kind };
  },
});

/** Rewrite renamed event kinds inside each `GroupWebhookEndpoint.subscriptions` array. */
export const renameWebhookEndpointSubscriptions = migrations.define({
  table: "GroupWebhookEndpoint",
  migrateOne: (_ctx, doc) => {
    const subscriptions = doc.subscriptions as string[];
    let changed = false;
    const next = subscriptions.map((kind) => {
      const renamed = CONNECTION_EVENT_KIND_RENAMES[kind];
      if (renamed !== undefined) changed = true;
      return renamed ?? kind;
    });
    return changed ? { subscriptions: next as typeof doc.subscriptions } : undefined;
  },
});

/** Rewrite renamed connection/SCIM `kind` values on `GroupWebhookDelivery` rows. */
export const renameWebhookDeliveryKinds = migrations.define({
  table: "GroupWebhookDelivery",
  migrateOne: (_ctx, doc) => {
    const next = CONNECTION_EVENT_KIND_RENAMES[doc.kind as string];
    return next === undefined ? undefined : { kind: next as typeof doc.kind };
  },
});

/**
 * CLI/dashboard runner — runs the three event-kind backfills as a series:
 * `npx convex run auth/migrations:runRenameConnectionEventKinds`.
 */
export const runRenameConnectionEventKinds = migrations.runner([
  internal.migrations.renameAuthEventProjectionKinds,
  internal.migrations.renameWebhookEndpointSubscriptions,
  internal.migrations.renameWebhookDeliveryKinds,
]);
