import { ConvexError, v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vGroupConnectionDomainDoc,
  vGroupConnectionDomainVerificationDoc,
} from "../../model";

/**
 * Link a domain to an connection record, or update an existing link.
 *
 * If the domain is already attached to a different connection, an
 * `GROUP_CONNECTION_DOMAIN_TAKEN` error is thrown. If the domain already exists for
 * this connection, it is updated in place (e.g. toggling `isPrimary`). When
 * `isPrimary` is `true`, any previously primary domain on the same connection
 * is demoted. The first domain added to an connection becomes primary by default.
 *
 * @param args.connectionId - The ID of the connection to attach the domain to.
 * @param args.groupId - The ID of the root group that owns the connection.
 * @param args.domain - The domain name to link (e.g. `"acme.com"`).
 * @param args.isPrimary - Whether this domain should be set as the primary domain for the connection. Defaults to `true` for the first domain.
 * @returns The ID of the created or updated `GroupConnectionDomain` document.
 *
 * @example
 * ```ts
 * const domainId = await ctx.runMutation(
 *   components.auth.connection.groupConnectionDomainAdd,
 *   {
 *     connectionId,
 *     groupId: orgGroupId,
 *     domain: "acme.com",
 *     isPrimary: true,
 *   },
 * );
 * ```
 */
export const groupConnectionDomainAdd = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    domain: v.string(),
    isPrimary: v.optional(v.boolean()),
  },
  returns: v.id("GroupConnectionDomain"),
  handler: async (ctx, args) => {
    const { connectionId, ...rest } = args;
    const existingByDomain = await ctx.db
      .query("GroupConnectionDomain")
      .withIndex("domain", (idx) => idx.eq("domain", args.domain))
      .first();
    if (existingByDomain && existingByDomain.connectionId !== connectionId) {
      throw new ConvexError({
        code: "GROUP_CONNECTION_DOMAIN_TAKEN",
        message: "That domain is already attached to another connection.",
      });
    }

    const existingForConnection = await ctx.db
      .query("GroupConnectionDomain")
      .withIndex("connection_id", (idx) => idx.eq("connectionId", connectionId))
      .collect();

    for (const row of existingForConnection) {
      if (row.domain === args.domain) {
        await ctx.db.patch(row._id, {
          isPrimary: args.isPrimary ?? row.isPrimary,
        });
        return row._id;
      }
    }

    if (args.isPrimary === true) {
      for (const row of existingForConnection) {
        if (row.isPrimary) {
          await ctx.db.patch(row._id, { isPrimary: false });
        }
      }
    }

    return await ctx.db.insert("GroupConnectionDomain", {
      connectionId: connectionId,
      ...rest,
      isPrimary: args.isPrimary ?? existingForConnection.length === 0,
    });
  },
});

/**
 * List all domains linked to a specific connection.
 *
 * Returns all `GroupConnectionDomain` documents associated with the given connection,
 * queried via the `connection_id` index. The result includes both verified and
 * unverified domains.
 *
 * @param args.connectionId - The ID of the connection whose domains to list.
 * @returns An array of connection domain documents.
 *
 * @example
 * ```ts
 * const domains = await ctx.runQuery(
 *   components.auth.connection.groupConnectionDomainList,
 *   { connectionId },
 * );
 * for (const d of domains) {
 *   console.log(d.domain, d.isPrimary, d.verifiedAt);
 * }
 * ```
 */
export const groupConnectionDomainList = query({
  args: { connectionId: v.id("GroupConnection") },
  returns: v.array(vGroupConnectionDomainDoc),
  handler: async (ctx, { connectionId }) => {
    return await ctx.db
      .query("GroupConnectionDomain")
      .withIndex("connection_id", (idx) => idx.eq("connectionId", connectionId))
      .collect();
  },
});

/**
 * Remove a linked connection domain and its associated verification record.
 *
 * Deletes the `GroupConnectionDomain` document and, if one exists, the related
 * `GroupConnectionDomainVerification` record. This is a permanent deletion.
 *
 * @param args.domainId - The document ID of the connection domain to remove.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.connection.groupConnectionDomainDelete,
 *   { domainId },
 * );
 * ```
 */
export const groupConnectionDomainDelete = mutation({
  args: { domainId: v.id("GroupConnectionDomain") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const verification = await ctx.db
      .query("GroupConnectionDomainVerification")
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
 * Retrieve the pending domain verification record for a given connection domain.
 *
 * Returns the `GroupConnectionDomainVerification` document associated with the
 * specified domain, or `null` if no verification has been initiated.
 *
 * @param args.domainId - The document ID of the connection domain whose verification to retrieve.
 * @returns The domain verification document, or `null` if none exists.
 *
 * @example
 * ```ts
 * const verification = await ctx.runQuery(
 *   components.auth.connection.groupConnectionDomainVerificationGet,
 *   { domainId },
 * );
 * if (verification) {
 *   console.log(verification.recordName, verification.expiresAt);
 * }
 * ```
 */
export const groupConnectionDomainVerificationGet = query({
  args: { domainId: v.id("GroupConnectionDomain") },
  returns: v.union(vGroupConnectionDomainVerificationDoc, v.null()),
  handler: async (ctx, { domainId }) => {
    return await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
  },
});

/**
 * Create or update a domain verification challenge for an connection domain.
 *
 * If a verification record already exists for the domain, all fields are
 * updated in place (e.g. to rotate the token). Otherwise a new record is
 * created. The caller is responsible for generating the DNS record name,
 * token, and token hash.
 *
 * @param args.connectionId - The ID of the connection that owns the domain.
 * @param args.groupId - The ID of the root group that owns the connection.
 * @param args.domainId - The document ID of the connection domain to verify.
 * @param args.domain - The domain name string (e.g. `"acme.com"`).
 * @param args.recordName - The DNS TXT record name to be published (e.g. `"_convex-verify.acme.com"`).
 * @param args.token - The plaintext verification token value.
 * @param args.tokenHash - A hash of the verification token for secure storage.
 * @param args.requestedAt - Epoch timestamp (ms) when the verification was requested.
 * @param args.expiresAt - Epoch timestamp (ms) after which the challenge expires.
 * @returns The ID of the created or updated `GroupConnectionDomainVerification` document.
 *
 * @example
 * ```ts
 * const verificationId = await ctx.runMutation(
 *   components.auth.connection.groupConnectionDomainVerificationUpsert,
 *   {
 *     connectionId,
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
export const groupConnectionDomainVerificationUpsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    domainId: v.id("GroupConnectionDomain"),
    domain: v.string(),
    recordName: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    requestedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: v.id("GroupConnectionDomainVerification"),
  handler: async (ctx, args) => {
    const { connectionId, ...rest } = args;
    const existing = await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", args.domainId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { connectionId: connectionId, ...rest });
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionDomainVerification", {
      connectionId: connectionId,
      ...rest,
    });
  },
});

/**
 * Delete the pending domain verification record for an connection domain.
 *
 * Removes the `GroupConnectionDomainVerification` document associated with the
 * given domain, effectively cancelling the verification challenge. If no
 * verification record exists, this is a no-op.
 *
 * @param args.domainId - The document ID of the connection domain whose verification to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.connection.groupConnectionDomainVerificationDelete,
 *   { domainId },
 * );
 * ```
 */
export const groupConnectionDomainVerificationDelete = mutation({
  args: { domainId: v.id("GroupConnectionDomain") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    const existing = await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

/**
 * Mark an connection domain as verified and clean up the verification record.
 *
 * Sets the `verifiedAt` timestamp on the domain document and deletes the
 * associated `GroupConnectionDomainVerification` record (if any). Throws an
 * `INVALID_PARAMETERS` error if the domain document does not exist.
 *
 * @param args.domainId - The document ID of the connection domain to mark as verified.
 * @param args.verifiedAt - Epoch timestamp (ms) at which the domain was verified.
 * @returns The updated connection domain document with the `verifiedAt` field set.
 *
 * @example
 * ```ts
 * const verifiedDomain = await ctx.runMutation(
 *   components.auth.connection.groupConnectionDomainVerify,
 *   { domainId, verifiedAt: Date.now() },
 * );
 * console.log("Domain verified:", verifiedDomain.domain);
 * ```
 */
export const groupConnectionDomainVerify = mutation({
  args: {
    domainId: v.id("GroupConnectionDomain"),
    verifiedAt: v.number(),
  },
  returns: vGroupConnectionDomainDoc,
  handler: async (ctx, { domainId, verifiedAt }) => {
    await ctx.db.patch(domainId, { verifiedAt });
    const domain = await ctx.db.get("GroupConnectionDomain", domainId);
    if (!domain) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Group Connection domain not found.",
      });
    }
    const verification = await ctx.db
      .query("GroupConnectionDomainVerification")
      .withIndex("domain_id", (idx) => idx.eq("domainId", domainId))
      .first();
    if (verification) {
      await ctx.db.delete(verification._id);
    }
    return domain;
  },
});
