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
    (doc as { hasTotp?: boolean }).hasTotp === undefined
      ? undefined
      : { hasTotp: undefined },
});

/** CLI/dashboard runner: `npx convex run auth/migrations:runDropHasTotp`. */
export const runDropHasTotp = migrations.runner(internal.migrations.dropHasTotp);
