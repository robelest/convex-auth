import { v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vGroupConnectionSecretDoc,
  vGroupConnectionSecretKind,
} from "../../model";

/**
 * Create or update an encrypted secret for an connection.
 *
 * Stores a secret identified by the combination of `(connectionId, kind)`.
 * If a secret of the same kind already exists for the connection, it is
 * updated with the new ciphertext and timestamp. Otherwise a new secret
 * document is created. Only one secret per kind is allowed per connection.
 *
 * @param args.connectionId - The ID of the connection the secret belongs to.
 * @param args.groupId - The ID of the root group that owns the connection.
 * @param args.kind - The type of secret being stored (e.g. `"oidc_client_secret"`).
 * @param args.ciphertext - The encrypted secret value.
 * @param args.updatedAt - Epoch timestamp (ms) when the secret was last updated.
 * @returns The ID of the created or updated `GroupConnectionSecret` document.
 *
 * @example
 * ```ts
 * const secretId = await ctx.runMutation(
 *   components.auth.connection.groupConnectionSecretUpsert,
 *   {
 *     connectionId,
 *     groupId: orgGroupId,
 *     kind: "oidc_client_secret",
 *     ciphertext: "encrypted:aes256:...",
 *     updatedAt: Date.now(),
 *   },
 * );
 * ```
 */
export const groupConnectionSecretUpsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    kind: vGroupConnectionSecretKind,
    ciphertext: v.string(),
    updatedAt: v.number(),
  },
  returns: v.id("GroupConnectionSecret"),
  handler: async (ctx, args) => {
    const { connectionId, ...rest } = args;
    const existing = await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id_kind", (idx) =>
        idx.eq("connectionId", connectionId).eq("kind", args.kind),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { connectionId: connectionId, ...rest });
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionSecret", {
      connectionId: connectionId,
      ...rest,
    });
  },
});

/**
 * Retrieve an encrypted secret for an connection by kind.
 *
 * Looks up the secret using the composite `(connectionId, kind)` index.
 * Returns the full document including the ciphertext, or `null` if no secret
 * of that kind has been stored for the connection.
 *
 * @param args.connectionId - The ID of the connection whose secret to retrieve.
 * @param args.kind - The type of secret to look up (e.g. `"oidc_client_secret"`).
 * @returns The connection secret document, or `null` if not found.
 *
 * @example
 * ```ts
 * const secret = await ctx.runQuery(
 *   components.auth.connection.groupConnectionSecretGet,
 *   { connectionId, kind: "oidc_client_secret" },
 * );
 * if (secret) {
 *   const plaintext = decrypt(secret.ciphertext);
 * }
 * ```
 */
export const groupConnectionSecretGet = query({
  args: {
    connectionId: v.id("GroupConnection"),
    kind: vGroupConnectionSecretKind,
  },
  returns: v.union(vGroupConnectionSecretDoc, v.null()),
  handler: async (ctx, { connectionId, kind }) => {
    return await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id_kind", (idx) =>
        idx.eq("connectionId", connectionId).eq("kind", kind),
      )
      .first();
  },
});

/**
 * Delete an encrypted secret for an connection by kind.
 *
 * Removes the secret document matching the `(connectionId, kind)` pair.
 * If no such secret exists, this is a no-op.
 *
 * @param args.connectionId - The ID of the connection whose secret to delete.
 * @param args.kind - The type of secret to remove (e.g. `"oidc_client_secret"`).
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.connection.groupConnectionSecretDelete,
 *   { connectionId, kind: "oidc_client_secret" },
 * );
 * ```
 */
export const groupConnectionSecretDelete = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    kind: vGroupConnectionSecretKind,
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, kind }) => {
    const existing = await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id_kind", (idx) =>
        idx.eq("connectionId", connectionId).eq("kind", kind),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});
