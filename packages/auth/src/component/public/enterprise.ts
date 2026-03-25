import {
  ConvexError,
  mutation,
  query,
  v,
  vAuditActorType,
  vAuditStatus,
  vEnterpriseAuditEventDoc,
  vEnterpriseDoc,
  vEnterpriseDomainDoc,
  vEnterpriseDomainVerificationDoc,
  vEnterprisePolicy,
  vEnterpriseScimConfigDoc,
  vEnterpriseScimIdentityDoc,
  vEnterpriseSecretDoc,
  vEnterpriseSecretKind,
  vEnterpriseStatus,
  vEnterpriseWebhookDeliveryDoc,
  vEnterpriseWebhookEndpointDoc,
  vPaginated,
  vScimResourceType,
  vScimStatus,
  vWebhookEndpointStatus,
} from "./shared";

// ============================================================================
// Enterprise
// ============================================================================

/** Create an enterprise record attached to a root group. */
export const enterpriseCreate = mutation({
  args: {
    groupId: v.id("Group"),
    slug: v.optional(v.string()),
    name: v.optional(v.string()),
    status: v.optional(vEnterpriseStatus),
    policy: v.optional(vEnterprisePolicy),
    config: v.optional(v.any()),
    extend: v.optional(v.any()),
  },
  returns: v.id("Enterprise"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("Enterprise")
      .withIndex("group_id", (idx) => idx.eq("groupId", args.groupId))
      .first();
    if (existing) {
      throw new ConvexError({
        code: "ENTERPRISE_ALREADY_EXISTS",
        message: "An enterprise record already exists for this group.",
      });
    }
    return await ctx.db.insert("Enterprise", {
      ...args,
      status: args.status ?? "draft",
    });
  },
});

/** Retrieve an enterprise record by ID. */
export const enterpriseGet = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.union(vEnterpriseDoc, v.null()),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db.get("Enterprise", enterpriseId);
  },
});

/** Retrieve an enterprise record by group ID. */
export const enterpriseGetByGroup = query({
  args: { groupId: v.id("Group") },
  returns: v.union(vEnterpriseDoc, v.null()),
  handler: async (ctx, { groupId }) => {
    return await ctx.db
      .query("Enterprise")
      .withIndex("group_id", (idx) => idx.eq("groupId", groupId))
      .first();
  },
});

/** Retrieve an enterprise record by a linked domain. */
export const enterpriseGetByDomain = query({
  args: { domain: v.string() },
  returns: v.union(
    v.object({
      enterprise: vEnterpriseDoc,
      domain: vEnterpriseDomainDoc,
    }),
    v.null(),
  ),
  handler: async (ctx, { domain }) => {
    const domainRow = await ctx.db
      .query("EnterpriseDomain")
      .withIndex("domain", (idx) => idx.eq("domain", domain))
      .first();
    if (!domainRow) {
      return null;
    }
    const enterprise = await ctx.db.get("Enterprise", domainRow.enterpriseId);
    if (!enterprise) {
      return null;
    }
    return { enterprise, domain: domainRow };
  },
});

/** List enterprises with lightweight filtering and cursor pagination. */
export const enterpriseList = query({
  args: {
    where: v.optional(
      v.object({
        groupId: v.optional(v.id("Group")),
        slug: v.optional(v.string()),
        status: v.optional(vEnterpriseStatus),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("slug"),
        v.literal("status"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vEnterpriseDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.groupId !== undefined) {
      q = ctx.db
        .query("Enterprise")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.slug !== undefined) {
      q = ctx.db
        .query("Enterprise")
        .withIndex("slug", (idx) => idx.eq("slug", where.slug!));
    } else if (where.status !== undefined) {
      q = ctx.db
        .query("Enterprise")
        .withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("Enterprise");
    }

    if (where.groupId !== undefined && where.slug !== undefined) {
      q = q.filter((f) => f.eq(f.field("slug"), where.slug!));
    }
    if (where.status !== undefined && where.groupId === undefined) {
      // already handled by index in the dedicated branch
    } else if (where.status !== undefined) {
      q = q.filter((f) => f.eq(f.field("status"), where.status!));
    }

    q = q.order(order);
    const all = await q.collect();
    let startIdx = 0;
    if (args.cursor) {
      const cursorIdx = all.findIndex((doc) => doc._id === args.cursor);
      if (cursorIdx !== -1) {
        startIdx = cursorIdx + 1;
      }
    }
    const page = all.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor };
  },
});

/** Patch an enterprise record. */
export const enterpriseUpdate = mutation({
  args: { enterpriseId: v.id("Enterprise"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { enterpriseId, data }) => {
    await ctx.db.patch(enterpriseId, data);
    return null;
  },
});

/** Delete an enterprise record. */
export const enterpriseDelete = mutation({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.null(),
  handler: async (ctx, { enterpriseId }) => {
    const domains = await ctx.db
      .query("EnterpriseDomain")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
    for (const domain of domains) {
      const verification = await ctx.db
        .query("EnterpriseDomainVerification")
        .withIndex("domain_id", (idx) => idx.eq("domainId", domain._id))
        .first();
      if (verification) {
        await ctx.db.delete(verification._id);
      }
      await ctx.db.delete(domain._id);
    }
    const secrets = await ctx.db
      .query("EnterpriseSecret")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
    for (const secret of secrets) {
      await ctx.db.delete(secret._id);
    }
    await ctx.db.delete(enterpriseId);
    return null;
  },
});

/** Link a domain to an enterprise record. */
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

/** List domains linked to an enterprise. */
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

/** Remove a linked enterprise domain. */
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

/** Create or rotate SCIM configuration for an enterprise. */
export const enterpriseScimConfigUpsert = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    status: vScimStatus,
    basePath: v.string(),
    tokenHash: v.string(),
    lastRotatedAt: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("EnterpriseScimConfig"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("EnterpriseScimConfig")
      .withIndex("enterprise_id", (idx) =>
        idx.eq("enterpriseId", args.enterpriseId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("EnterpriseScimConfig", args);
  },
});

export const enterpriseScimConfigGetByEnterprise = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.union(vEnterpriseScimConfigDoc, v.null()),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseScimConfig")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .first();
  },
});

export const enterpriseScimConfigGetByTokenHash = query({
  args: { tokenHash: v.string() },
  returns: v.union(vEnterpriseScimConfigDoc, v.null()),
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("EnterpriseScimConfig")
      .withIndex("token_hash", (idx) => idx.eq("tokenHash", tokenHash))
      .first();
  },
});

export const enterpriseScimIdentityGet = query({
  args: {
    enterpriseId: v.id("Enterprise"),
    resourceType: vScimResourceType,
    externalId: v.string(),
  },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id_resource_type_external_id", (idx) =>
        idx
          .eq("enterpriseId", args.enterpriseId)
          .eq("resourceType", args.resourceType)
          .eq("externalId", args.externalId),
      )
      .first();
  },
});

export const enterpriseScimIdentityGetByUser = query({
  args: { userId: v.id("User") },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("user_id", (idx) => idx.eq("userId", userId))
      .first();
  },
});

export const enterpriseScimIdentityGetByEnterpriseAndUser = query({
  args: {
    enterpriseId: v.id("Enterprise"),
    userId: v.id("User"),
  },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, { enterpriseId, userId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id_user_id", (idx) =>
        idx.eq("enterpriseId", enterpriseId).eq("userId", userId),
      )
      .first();
  },
});

export const enterpriseScimIdentityGetByMappedGroup = query({
  args: { mappedGroupId: v.id("Group") },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, { mappedGroupId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("mapped_group_id", (idx) =>
        idx.eq("mappedGroupId", mappedGroupId),
      )
      .first();
  },
});

export const enterpriseScimIdentityListByEnterprise = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.array(vEnterpriseScimIdentityDoc),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
  },
});

export const enterpriseScimIdentityUpsert = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    resourceType: vScimResourceType,
    externalId: v.string(),
    userId: v.optional(v.id("User")),
    mappedGroupId: v.optional(v.id("Group")),
    lastProvisionedAt: v.optional(v.number()),
    active: v.optional(v.boolean()),
    raw: v.optional(v.any()),
  },
  returns: v.id("EnterpriseScimIdentity"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id_resource_type_external_id", (idx) =>
        idx
          .eq("enterpriseId", args.enterpriseId)
          .eq("resourceType", args.resourceType)
          .eq("externalId", args.externalId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("EnterpriseScimIdentity", args);
  },
});

export const enterpriseScimIdentityDelete = mutation({
  args: { identityId: v.id("EnterpriseScimIdentity") },
  returns: v.null(),
  handler: async (ctx, { identityId }) => {
    await ctx.db.delete(identityId);
    return null;
  },
});

export const enterpriseAuditEventCreate = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    eventType: v.string(),
    actorType: vAuditActorType,
    actorId: v.optional(v.string()),
    subjectType: v.string(),
    subjectId: v.optional(v.string()),
    status: vAuditStatus,
    occurredAt: v.number(),
    requestId: v.optional(v.string()),
    ip: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("EnterpriseAuditEvent"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("EnterpriseAuditEvent", args);
  },
});

export const enterpriseAuditEventList = query({
  args: {
    enterpriseId: v.optional(v.id("Enterprise")),
    groupId: v.optional(v.id("Group")),
    limit: v.optional(v.number()),
  },
  returns: v.array(vEnterpriseAuditEventDoc),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (args.enterpriseId !== undefined) {
      return await ctx.db
        .query("EnterpriseAuditEvent")
        .withIndex("enterprise_id_occurred_at", (idx) =>
          idx.eq("enterpriseId", args.enterpriseId!),
        )
        .order("desc")
        .take(limit);
    }
    if (args.groupId !== undefined) {
      return await ctx.db
        .query("EnterpriseAuditEvent")
        .withIndex("group_id_occurred_at", (idx) =>
          idx.eq("groupId", args.groupId!),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("EnterpriseAuditEvent").order("desc").take(limit);
  },
});

export const enterpriseWebhookEndpointCreate = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    url: v.string(),
    status: v.optional(vWebhookEndpointStatus),
    secretHash: v.string(),
    subscriptions: v.array(v.string()),
    createdByUserId: v.optional(v.id("User")),
    extend: v.optional(v.any()),
  },
  returns: v.id("EnterpriseWebhookEndpoint"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("EnterpriseWebhookEndpoint", {
      ...args,
      status: args.status ?? "active",
      failureCount: 0,
    });
  },
});

export const enterpriseWebhookEndpointList = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.array(vEnterpriseWebhookEndpointDoc),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseWebhookEndpoint")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
  },
});

export const enterpriseWebhookEndpointGet = query({
  args: { endpointId: v.id("EnterpriseWebhookEndpoint") },
  returns: v.union(vEnterpriseWebhookEndpointDoc, v.null()),
  handler: async (ctx, { endpointId }) => {
    return await ctx.db.get(endpointId);
  },
});

export const enterpriseWebhookEndpointUpdate = mutation({
  args: { endpointId: v.id("EnterpriseWebhookEndpoint"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { endpointId, data }) => {
    await ctx.db.patch(endpointId, data);
    return null;
  },
});

export const enterpriseWebhookDeliveryEnqueue = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    endpointId: v.id("EnterpriseWebhookEndpoint"),
    auditEventId: v.optional(v.id("EnterpriseAuditEvent")),
    eventType: v.string(),
    payload: v.any(),
    nextAttemptAt: v.number(),
  },
  returns: v.id("EnterpriseWebhookDelivery"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("EnterpriseWebhookDelivery", {
      ...args,
      status: "pending",
      attemptCount: 0,
    });
  },
});

export const enterpriseWebhookDeliveryListReady = query({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.array(vEnterpriseWebhookDeliveryDoc),
  handler: async (ctx, { now, limit }) => {
    return await ctx.db
      .query("EnterpriseWebhookDelivery")
      .withIndex("status_next_attempt_at", (idx) =>
        idx.eq("status", "pending").lte("nextAttemptAt", now),
      )
      .take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});

export const enterpriseWebhookDeliveryList = query({
  args: { enterpriseId: v.id("Enterprise"), limit: v.optional(v.number()) },
  returns: v.array(vEnterpriseWebhookDeliveryDoc),
  handler: async (ctx, { enterpriseId, limit }) => {
    return await ctx.db
      .query("EnterpriseWebhookDelivery")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});

export const enterpriseWebhookDeliveryPatch = mutation({
  args: { deliveryId: v.id("EnterpriseWebhookDelivery"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { deliveryId, data }) => {
    await ctx.db.patch(deliveryId, data);
    return null;
  },
});
