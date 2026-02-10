import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Users
export const userGetById = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

export const userFindByVerifiedEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db
      .query("user")
      .withIndex("email", (q) => q.eq("email", email))
      .filter((q) => q.neq(q.field("emailVerificationTime"), undefined))
      .take(2);
    return users.length === 1 ? users[0] : null;
  },
});

export const userFindByVerifiedPhone = query({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const users = await ctx.db
      .query("user")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .filter((q) => q.neq(q.field("phoneVerificationTime"), undefined))
      .take(2);
    return users.length === 1 ? users[0] : null;
  },
});

export const userInsert = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    return await ctx.db.insert("user", data);
  },
});

export const userUpsert = mutation({
  args: { userId: v.optional(v.id("user")), data: v.any() },
  handler: async (ctx, { userId, data }) => {
    if (userId !== undefined) {
      await ctx.db.patch(userId, data);
      return userId;
    }
    return await ctx.db.insert("user", data);
  },
});

export const userPatch = mutation({
  args: { userId: v.id("user"), data: v.any() },
  handler: async (ctx, { userId, data }) => {
    await ctx.db.patch(userId, data);
  },
});

// Accounts
export const accountGet = query({
  args: { provider: v.string(), providerAccountId: v.string() },
  handler: async (ctx, { provider, providerAccountId }) => {
    return await ctx.db
      .query("account")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", provider).eq("providerAccountId", providerAccountId),
      )
      .unique();
  },
});

export const accountGetById = query({
  args: { accountId: v.id("account") },
  handler: async (ctx, { accountId }) => {
    return await ctx.db.get(accountId);
  },
});

export const accountInsert = mutation({
  args: {
    userId: v.id("user"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("account", args as any);
  },
});

export const accountPatch = mutation({
  args: { accountId: v.id("account"), data: v.any() },
  handler: async (ctx, { accountId, data }) => {
    await ctx.db.patch(accountId, data);
  },
});

export const accountDelete = mutation({
  args: { accountId: v.id("account") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.delete(accountId);
  },
});

// Sessions
export const sessionCreate = mutation({
  args: { userId: v.id("user"), expirationTime: v.number() },
  handler: async (ctx, { userId, expirationTime }) => {
    return await ctx.db.insert("session", {
      userId: userId as any,
      expirationTime,
    });
  },
});

export const sessionGetById = query({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get(sessionId);
  },
});

export const sessionDelete = mutation({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    if ((await ctx.db.get(sessionId)) !== null) {
      await ctx.db.delete(sessionId);
    }
  },
});

export const sessionListByUser = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("session")
      .withIndex("userId", (q) => q.eq("userId", userId as any))
      .collect();
  },
});

// Verifiers
export const verifierCreate = mutation({
  args: { sessionId: v.optional(v.id("session")) },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.insert("verifier", { sessionId: sessionId as any });
  },
});

export const verifierGetById = query({
  args: { verifierId: v.id("verifier") },
  handler: async (ctx, { verifierId }) => {
    return await ctx.db.get(verifierId);
  },
});

export const verifierGetBySignature = query({
  args: { signature: v.string() },
  handler: async (ctx, { signature }) => {
    return await ctx.db
      .query("verifier")
      .withIndex("signature", (q) => q.eq("signature", signature))
      .unique();
  },
});

export const verifierPatch = mutation({
  args: { verifierId: v.id("verifier"), data: v.any() },
  handler: async (ctx, { verifierId, data }) => {
    await ctx.db.patch(verifierId, data);
  },
});

export const verifierDelete = mutation({
  args: { verifierId: v.id("verifier") },
  handler: async (ctx, { verifierId }) => {
    await ctx.db.delete(verifierId);
  },
});

// Verification codes
export const verificationCodeGetByAccountId = query({
  args: { accountId: v.id("account") },
  handler: async (ctx, { accountId }) => {
    return await ctx.db
      .query("verification")
      .withIndex("accountId", (q) => q.eq("accountId", accountId as any))
      .unique();
  },
});

export const verificationCodeGetByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("verification")
      .withIndex("code", (q) => q.eq("code", code))
      .unique();
  },
});

export const verificationCodeCreate = mutation({
  args: {
    accountId: v.id("account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("verification", args as any);
  },
});

export const verificationCodeDelete = mutation({
  args: { verificationCodeId: v.id("verification") },
  handler: async (ctx, { verificationCodeId }) => {
    await ctx.db.delete(verificationCodeId);
  },
});

// Refresh tokens
export const refreshTokenCreate = mutation({
  args: {
    sessionId: v.id("session"),
    expirationTime: v.number(),
    parentRefreshTokenId: v.optional(v.id("token")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("token", args as any);
  },
});

export const refreshTokenGetById = query({
  args: { refreshTokenId: v.id("token") },
  handler: async (ctx, { refreshTokenId }) => {
    return await ctx.db.get(refreshTokenId);
  },
});

export const refreshTokenPatch = mutation({
  args: { refreshTokenId: v.id("token"), data: v.any() },
  handler: async (ctx, { refreshTokenId, data }) => {
    await ctx.db.patch(refreshTokenId, data);
  },
});

export const refreshTokenGetChildren = query({
  args: {
    sessionId: v.id("session"),
    parentRefreshTokenId: v.id("token"),
  },
  handler: async (ctx, { sessionId, parentRefreshTokenId }) => {
    return await ctx.db
      .query("token")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q
          .eq("sessionId", sessionId as any)
          .eq("parentRefreshTokenId", parentRefreshTokenId as any),
      )
      .collect();
  },
});

export const refreshTokenListBySession = query({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("token")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q.eq("sessionId", sessionId as any),
      )
      .collect();
  },
});

export const refreshTokenDeleteAll = mutation({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    const tokens = await ctx.db
      .query("token")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q.eq("sessionId", sessionId as any),
      )
      .collect();
    await Promise.all(tokens.map((token) => ctx.db.delete(token._id)));
  },
});

export const refreshTokenGetActive = query({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("token")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId as any))
      .filter((q) => q.eq(q.field("firstUsedTime"), undefined))
      .order("desc")
      .first();
  },
});

// Rate limits
export const rateLimitGet = query({
  args: { identifier: v.string() },
  handler: async (ctx, { identifier }) => {
    return await ctx.db
      .query("limit")
      .withIndex("identifier", (q) => q.eq("identifier", identifier))
      .unique();
  },
});

export const rateLimitCreate = mutation({
  args: {
    identifier: v.string(),
    attemptsLeft: v.number(),
    lastAttemptTime: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("limit", args);
  },
});

export const rateLimitPatch = mutation({
  args: { rateLimitId: v.id("limit"), data: v.any() },
  handler: async (ctx, { rateLimitId, data }) => {
    await ctx.db.patch(rateLimitId, data);
  },
});

export const rateLimitDelete = mutation({
  args: { rateLimitId: v.id("limit") },
  handler: async (ctx, { rateLimitId }) => {
    await ctx.db.delete(rateLimitId);
  },
});

// Singular aliases
export const verificationGetByAccountId = verificationCodeGetByAccountId;
export const verificationGetByCode = verificationCodeGetByCode;
export const verificationCreate = verificationCodeCreate;
export const verificationDelete = verificationCodeDelete;

export const tokenCreate = refreshTokenCreate;
export const tokenGetById = refreshTokenGetById;
export const tokenPatch = refreshTokenPatch;
export const tokenGetChildren = refreshTokenGetChildren;
export const tokenListBySession = refreshTokenListBySession;
export const tokenDeleteAll = refreshTokenDeleteAll;
export const tokenGetActive = refreshTokenGetActive;

export const limitGet = rateLimitGet;
export const limitCreate = rateLimitCreate;
export const limitPatch = rateLimitPatch;
export const limitDelete = rateLimitDelete;

// Organization
export const organizationCreate = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    return await (ctx.db as any).insert("organization", data);
  },
});

export const organizationGet = query({
  args: { organizationId: v.id("organization") },
  handler: async (ctx, { organizationId }) => {
    return await (ctx.db as any).get(organizationId);
  },
});

export const organizationList = query({
  args: { ownerUserId: v.optional(v.id("user")) },
  handler: async (ctx, { ownerUserId }) => {
    if (ownerUserId === undefined) {
      return await (ctx.db as any).query("organization").collect();
    }
    return await (ctx.db as any)
      .query("organization")
      .withIndex("ownerUserId", (q: any) => q.eq("ownerUserId", ownerUserId))
      .collect();
  },
});

export const organizationUpdate = mutation({
  args: { organizationId: v.id("organization"), data: v.any() },
  handler: async (ctx, { organizationId, data }) => {
    await (ctx.db as any).patch(organizationId, data);
  },
});

export const organizationDelete = mutation({
  args: { organizationId: v.id("organization") },
  handler: async (ctx, { organizationId }) => {
    await (ctx.db as any).delete(organizationId);
  },
});

// Team
export const teamCreate = mutation({
  args: {
    organizationId: v.id("organization"),
    name: v.string(),
    slug: v.optional(v.string()),
    parentTeamId: v.optional(v.id("team")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await (ctx.db as any).insert("team", args);
  },
});

export const teamGet = query({
  args: { teamId: v.id("team") },
  handler: async (ctx, { teamId }) => {
    return await (ctx.db as any).get(teamId);
  },
});

export const teamListByOrganization = query({
  args: { organizationId: v.id("organization") },
  handler: async (ctx, { organizationId }) => {
    return await (ctx.db as any)
      .query("team")
      .withIndex("organizationId", (q: any) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
  },
});

export const teamUpdate = mutation({
  args: { teamId: v.id("team"), data: v.any() },
  handler: async (ctx, { teamId, data }) => {
    await (ctx.db as any).patch(teamId, data);
  },
});

export const teamDelete = mutation({
  args: { teamId: v.id("team") },
  handler: async (ctx, { teamId }) => {
    await (ctx.db as any).delete(teamId);
  },
});

// Team relations
export const teamRelationCreate = mutation({
  args: {
    organizationId: v.id("organization"),
    parentTeamId: v.id("team"),
    childTeamId: v.id("team"),
    relation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await (ctx.db as any).insert("teamRelation", args);
  },
});

export const teamRelationGet = query({
  args: { teamRelationId: v.id("teamRelation") },
  handler: async (ctx, { teamRelationId }) => {
    return await (ctx.db as any).get(teamRelationId);
  },
});

export const teamRelationListByParent = query({
  args: {
    organizationId: v.id("organization"),
    parentTeamId: v.id("team"),
  },
  handler: async (ctx, { organizationId, parentTeamId }) => {
    return await (ctx.db as any)
      .query("teamRelation")
      .withIndex("organizationIdAndParentTeamId", (q: any) =>
        q.eq("organizationId", organizationId).eq("parentTeamId", parentTeamId),
      )
      .collect();
  },
});

export const teamRelationDelete = mutation({
  args: { teamRelationId: v.id("teamRelation") },
  handler: async (ctx, { teamRelationId }) => {
    await (ctx.db as any).delete(teamRelationId);
  },
});

// Members
export const memberAdd = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    return await (ctx.db as any).insert("member", data);
  },
});

export const memberRemove = mutation({
  args: { memberId: v.id("member") },
  handler: async (ctx, { memberId }) => {
    await (ctx.db as any).delete(memberId);
  },
});

export const memberList = query({
  args: {
    organizationId: v.id("organization"),
    teamId: v.optional(v.id("team")),
  },
  handler: async (ctx, { organizationId, teamId }) => {
    if (teamId !== undefined) {
      return await (ctx.db as any)
        .query("member")
        .withIndex("teamId", (q: any) => q.eq("teamId", teamId))
        .collect();
    }
    return await (ctx.db as any)
      .query("member")
      .withIndex("organizationId", (q: any) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
  },
});

export const memberRoleSet = mutation({
  args: { memberId: v.id("member"), role: v.string() },
  handler: async (ctx, { memberId, role }) => {
    await (ctx.db as any).patch(memberId, { role });
  },
});

export const memberRoleGet = query({
  args: { memberId: v.id("member") },
  handler: async (ctx, { memberId }) => {
    const member = await (ctx.db as any).get(memberId);
    return member?.role ?? null;
  },
});

// Invites
export const inviteCreate = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    return await (ctx.db as any).insert("invite", data);
  },
});

export const inviteGet = query({
  args: { inviteId: v.id("invite") },
  handler: async (ctx, { inviteId }) => {
    return await (ctx.db as any).get(inviteId);
  },
});

export const inviteList = query({
  args: {
    organizationId: v.optional(v.id("organization")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { organizationId, status }) => {
    if (organizationId !== undefined && status !== undefined) {
      return await (ctx.db as any)
        .query("invite")
        .withIndex("organizationIdAndStatus", (q: any) =>
          q.eq("organizationId", organizationId).eq("status", status),
        )
        .collect();
    }
    if (organizationId !== undefined) {
      return await (ctx.db as any)
        .query("invite")
        .withIndex("organizationId", (q: any) =>
          q.eq("organizationId", organizationId),
        )
        .collect();
    }
    if (status !== undefined) {
      return await (ctx.db as any)
        .query("invite")
        .filter((q: any) => q.eq(q.field("status"), status))
        .collect();
    }
    return await (ctx.db as any)
      .query("invite")
      .collect();
  },
});

export const inviteAccept = mutation({
  args: { inviteId: v.id("invite") },
  handler: async (ctx, { inviteId }) => {
    await (ctx.db as any).patch(inviteId, {
      status: "accepted",
      acceptedTime: Date.now(),
    });
  },
});

export const inviteRevoke = mutation({
  args: { inviteId: v.id("invite") },
  handler: async (ctx, { inviteId }) => {
    await (ctx.db as any).patch(inviteId, { status: "revoked" });
  },
});
