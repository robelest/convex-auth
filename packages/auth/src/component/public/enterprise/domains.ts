import { ConvexError, v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vEnterpriseDomainDoc,
  vEnterpriseDomainVerificationDoc,
} from "../../model";

/**
 * Link a domain to an enterprise record, or update an existing link.
 *
 * If the domain is already attached to a different enterprise, an
 * `ENTERPRISE_DOMAIN_TAKEN` error is thrown. If the domain already exists for
 * this enterprise, it is updated in place (e.g. toggling `isPrimary`). When
 * `isPrimary` is `true`, any previously primary domain on the same enterprise
 * is demoted. The first domain added to an enterprise becomes primary by default.
 *
 * @param args.enterpriseId - The ID of the enterprise to attach the domain to.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.domain - The domain name to link (e.g. `"acme.com"`).
 * @param args.isPrimary - Whether this domain should be set as the primary domain for the enterprise. Defaults to `true` for the first domain.
 * @returns The ID of the created or updated `EnterpriseDomain` document.
 *
 * @example
 * ```ts
 * const domainId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseDomainAdd,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     domain: "acme.com",
 *     isPrimary: true,
 *   },
 * );
 * ```
 */
export const enterpriseDomainAdd = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    domain: v.string(),
    isPrimary: v.optional(v.boolean()),
  },
  returns: v.id("EnterpriseDomain"),
  handler: async (ctx, args) => {
    const existingByDomain = await ctx.db
      .query("EnterpriseDomain")
      .withIndex("domain", (idx) => idx.eq("domain", args.domain))
      .first();
    if (
      existingByDomain &&
      existingByDomain.enterpriseId !== args.enterpriseId
    ) {
      throw new ConvexError({
        code: "ENTERPRISE_DOMAIN_TAKEN",
        message: "That domain is already attached to another enterprise.",
      });
    }

    const existingForEnterprise = await ctx.db
      .query("EnterpriseDomain")
      .withIndex("enterprise_id", (idx) =>
        idx.eq("enterpriseId", args.enterpriseId),
      )
      .collect();

    for (const row of existingForEnterprise) {
      if (row.domain === args.domain) {
        await ctx.db.patch(row._id, {
          isPrimary: args.isPrimary ?? row.isPrimary,
        });
        return row._id;
      }
    }

    if (args.isPrimary === true) {
      for (const row of existingForEnterprise) {
        if (row.isPrimary) {
          await ctx.db.patch(row._id, { isPrimary: false });
        }
      }
    }

    return await ctx.db.insert("EnterpriseDomain", {
      ...args,
      isPrimary: args.isPrimary ?? existingForEnterprise.length === 0,
    });
  },
});

/**
 * List all domains linked to a specific enterprise.
 *
 * Returns all `EnterpriseDomain` documents associated with the given enterprise,
 * queried via the `enterprise_id` index. The result includes both verified and
 * unverified domains.
 *
 * @param args.enterpriseId - The ID of the enterprise whose domains to list.
 * @returns An array of enterprise domain documents.
 *
 * @example
 * ```ts
 * const domains = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseDomainList,
 *   { enterpriseId },
 * );
 * for (const d of domains) {
 *   console.log(d.domain, d.isPrimary, d.verifiedAt);
 * }
 * ```
 */
export const enterpriseDomainList = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.array(vEnterpriseDomainDoc),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseDomain")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
  },
});

/**
 * Remove a linked enterprise domain and its associated verification record.
 *
 * Deletes the `EnterpriseDomain` document and, if one exists, the related
 * `EnterpriseDomainVerification` record. This is a permanent deletion.
 *
 * @param args.domainId - The document ID of the enterprise domain to remove.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseDomainDelete,
 *   { domainId },
 * );
 * ```
 */
export const enterpriseDomainDelete = mutation({
  args: { domainId: v.id("EnterpriseDomain") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const verification = await ctx.db
      .query("EnterpriseDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
    if (verification) {
      await ctx.db.delete(verification._id);
    }
    await ctx.db.delete(domainId);
    return null;
  },
});

/**
 * Retrieve the pending domain verification record for a given enterprise domain.
 *
 * Returns the `EnterpriseDomainVerification` document associated with the
 * specified domain, or `null` if no verification has been initiated.
 *
 * @param args.domainId - The document ID of the enterprise domain whose verification to retrieve.
 * @returns The domain verification document, or `null` if none exists.
 *
 * @example
 * ```ts
 * const verification = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseDomainVerificationGet,
 *   { domainId },
 * );
 * if (verification) {
 *   console.log(verification.recordName, verification.expiresAt);
 * }
 * ```
 */
export const enterpriseDomainVerificationGet = query({
  args: { domainId: v.id("EnterpriseDomain") },
  returns: v.union(vEnterpriseDomainVerificationDoc, v.null()),
  handler: async (ctx, { domainId }) => {
    return await ctx.db
      .query("EnterpriseDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
  },
});

/**
 * Create or update a domain verification challenge for an enterprise domain.
 *
 * If a verification record already exists for the domain, all fields are
 * updated in place (e.g. to rotate the token). Otherwise a new record is
 * created. The caller is responsible for generating the DNS record name,
 * token, and token hash.
 *
 * @param args.enterpriseId - The ID of the enterprise that owns the domain.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.domainId - The document ID of the enterprise domain to verify.
 * @param args.domain - The domain name string (e.g. `"acme.com"`).
 * @param args.recordName - The DNS TXT record name to be published (e.g. `"_convex-verify.acme.com"`).
 * @param args.token - The plaintext verification token value.
 * @param args.tokenHash - A hash of the verification token for secure storage.
 * @param args.requestedAt - Epoch timestamp (ms) when the verification was requested.
 * @param args.expiresAt - Epoch timestamp (ms) after which the challenge expires.
 * @returns The ID of the created or updated `EnterpriseDomainVerification` document.
 *
 * @example
 * ```ts
 * const verificationId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseDomainVerificationUpsert,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     domainId,
 *     domain: "acme.com",
 *     recordName: "_convex-verify.acme.com",
 *     token: "abc123",
 *     tokenHash: "sha256:...",
 *     requestedAt: Date.now(),
 *     expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
 *   },
 * );
 * ```
 */
export const enterpriseDomainVerificationUpsert = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    domainId: v.id("EnterpriseDomain"),
    domain: v.string(),
    recordName: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    requestedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.id("EnterpriseDomainVerification"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("EnterpriseDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", args.domainId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("EnterpriseDomainVerification", args);
  },
});

/**
 * Delete the pending domain verification record for an enterprise domain.
 *
 * Removes the `EnterpriseDomainVerification` document associated with the
 * given domain, effectively cancelling the verification challenge. If no
 * verification record exists, this is a no-op.
 *
 * @param args.domainId - The document ID of the enterprise domain whose verification to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseDomainVerificationDelete,
 *   { domainId },
 * );
 * ```
 */
export const enterpriseDomainVerificationDelete = mutation({
  args: { domainId: v.id("EnterpriseDomain") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const existing = await ctx.db
      .query("EnterpriseDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

/**
 * Mark an enterprise domain as verified and clean up the verification record.
 *
 * Sets the `verifiedAt` timestamp on the domain document and deletes the
 * associated `EnterpriseDomainVerification` record (if any). Throws an
 * `INVALID_PARAMETERS` error if the domain document does not exist.
 *
 * @param args.domainId - The document ID of the enterprise domain to mark as verified.
 * @param args.verifiedAt - Epoch timestamp (ms) at which the domain was verified.
 * @returns The updated enterprise domain document with the `verifiedAt` field set.
 *
 * @example
 * ```ts
 * const verifiedDomain = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseDomainVerify,
 *   { domainId, verifiedAt: Date.now() },
 * );
 * console.log("Domain verified:", verifiedDomain.domain);
 * ```
 */
export const enterpriseDomainVerify = mutation({
  args: {
    domainId: v.id("EnterpriseDomain"),
    verifiedAt: v.number(),
  },
  returns: vEnterpriseDomainDoc,
  handler: async (ctx, { domainId, verifiedAt }) => {
    await ctx.db.patch(domainId, { verifiedAt });
    const domain = await ctx.db.get("EnterpriseDomain", domainId);
    if (!domain) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Enterprise domain not found.",
      });
    }
    const verification = await ctx.db
      .query("EnterpriseDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
    if (verification) {
      await ctx.db.delete(verification._id);
    }
    return domain;
  },
});
