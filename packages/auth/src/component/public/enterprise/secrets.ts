import { v } from "convex/values";
import { mutation, query } from "../../functions";
import { vEnterpriseSecretDoc, vEnterpriseSecretKind } from "../../model";

/**
 * Create or update an encrypted secret for an enterprise.
 *
 * Stores a secret identified by the combination of `(enterpriseId, kind)`.
 * If a secret of the same kind already exists for the enterprise, it is
 * updated with the new ciphertext and timestamp. Otherwise a new secret
 * document is created. Only one secret per kind is allowed per enterprise.
 *
 * @param args.enterpriseId - The ID of the enterprise the secret belongs to.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.kind - The type of secret being stored (e.g. `"oidc_client_secret"`).
 * @param args.ciphertext - The encrypted secret value.
 * @param args.updatedAt - Epoch timestamp (ms) when the secret was last updated.
 * @returns The ID of the created or updated `EnterpriseSecret` document.
 *
 * @example
 * ```ts
 * const secretId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseSecretUpsert,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     kind: "oidc_client_secret",
 *     ciphertext: "encrypted:aes256:...",
 *     updatedAt: Date.now(),
 *   },
 * );
 * ```
 */
export const enterpriseSecretUpsert = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    kind: vEnterpriseSecretKind,
    ciphertext: v.string(),
    updatedAt: v.number(),
  },
  returns: v.id("EnterpriseSecret"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("EnterpriseSecret")
      .withIndex("enterprise_id_kind", (idx) =>
        idx.eq("enterpriseId", args.enterpriseId).eq("kind", args.kind),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("EnterpriseSecret", args);
  },
});

/**
 * Retrieve an encrypted secret for an enterprise by kind.
 *
 * Looks up the secret using the composite `(enterpriseId, kind)` index.
 * Returns the full document including the ciphertext, or `null` if no secret
 * of that kind has been stored for the enterprise.
 *
 * @param args.enterpriseId - The ID of the enterprise whose secret to retrieve.
 * @param args.kind - The type of secret to look up (e.g. `"oidc_client_secret"`).
 * @returns The enterprise secret document, or `null` if not found.
 *
 * @example
 * ```ts
 * const secret = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseSecretGet,
 *   { enterpriseId, kind: "oidc_client_secret" },
 * );
 * if (secret) {
 *   const plaintext = decrypt(secret.ciphertext);
 * }
 * ```
 */
export const enterpriseSecretGet = query({
  args: {
    enterpriseId: v.id("Enterprise"),
    kind: vEnterpriseSecretKind,
  },
  returns: v.union(vEnterpriseSecretDoc, v.null()),
  handler: async (ctx, { enterpriseId, kind }) => {
    return await ctx.db
      .query("EnterpriseSecret")
      .withIndex("enterprise_id_kind", (idx) =>
        idx.eq("enterpriseId", enterpriseId).eq("kind", kind),
      )
      .first();
  },
});

/**
 * Delete an encrypted secret for an enterprise by kind.
 *
 * Removes the secret document matching the `(enterpriseId, kind)` pair.
 * If no such secret exists, this is a no-op.
 *
 * @param args.enterpriseId - The ID of the enterprise whose secret to delete.
 * @param args.kind - The type of secret to remove (e.g. `"oidc_client_secret"`).
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseSecretDelete,
 *   { enterpriseId, kind: "oidc_client_secret" },
 * );
 * ```
 */
export const enterpriseSecretDelete = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    kind: vEnterpriseSecretKind,
  },
  returns: v.null(),
  handler: async (ctx, { enterpriseId, kind }) => {
    const existing = await ctx.db
      .query("EnterpriseSecret")
      .withIndex("enterprise_id_kind", (idx) =>
        idx.eq("enterpriseId", enterpriseId).eq("kind", kind),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});
