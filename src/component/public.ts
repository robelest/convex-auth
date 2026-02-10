import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Users
export const userGetById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

export const userFindByVerifiedEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db
      .query("users")
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
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .filter((q) => q.neq(q.field("phoneVerificationTime"), undefined))
      .take(2);
    return users.length === 1 ? users[0] : null;
  },
});

export const userInsert = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    return await ctx.db.insert("users", data);
  },
});

export const userUpsert = mutation({
  args: { userId: v.optional(v.id("users")), data: v.any() },
  handler: async (ctx, { userId, data }) => {
    if (userId !== undefined) {
      await ctx.db.patch(userId, data);
      return userId;
    }
    return await ctx.db.insert("users", data);
  },
});

export const userPatch = mutation({
  args: { userId: v.id("users"), data: v.any() },
  handler: async (ctx, { userId, data }) => {
    await ctx.db.patch(userId, data);
  },
});

// Accounts
export const accountGet = query({
  args: { provider: v.string(), providerAccountId: v.string() },
  handler: async (ctx, { provider, providerAccountId }) => {
    return await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", provider).eq("providerAccountId", providerAccountId),
      )
      .unique();
  },
});

export const accountGetById = query({
  args: { accountId: v.id("authAccounts") },
  handler: async (ctx, { accountId }) => {
    return await ctx.db.get(accountId);
  },
});

export const accountInsert = mutation({
  args: {
    userId: v.id("users"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("authAccounts", args);
  },
});

export const accountPatch = mutation({
  args: { accountId: v.id("authAccounts"), data: v.any() },
  handler: async (ctx, { accountId, data }) => {
    await ctx.db.patch(accountId, data);
  },
});

export const accountDelete = mutation({
  args: { accountId: v.id("authAccounts") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.delete(accountId);
  },
});

// Sessions
export const sessionCreate = mutation({
  args: { userId: v.id("users"), expirationTime: v.number() },
  handler: async (ctx, { userId, expirationTime }) => {
    return await ctx.db.insert("authSessions", { userId, expirationTime });
  },
});

export const sessionGetById = query({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get(sessionId);
  },
});

export const sessionDelete = mutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    if ((await ctx.db.get(sessionId)) !== null) {
      await ctx.db.delete(sessionId);
    }
  },
});

export const sessionListByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Verifiers
export const verifierCreate = mutation({
  args: { sessionId: v.optional(v.id("authSessions")) },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.insert("authVerifiers", { sessionId });
  },
});

export const verifierGetById = query({
  args: { verifierId: v.id("authVerifiers") },
  handler: async (ctx, { verifierId }) => {
    return await ctx.db.get(verifierId);
  },
});

export const verifierGetBySignature = query({
  args: { signature: v.string() },
  handler: async (ctx, { signature }) => {
    return await ctx.db
      .query("authVerifiers")
      .withIndex("signature", (q) => q.eq("signature", signature))
      .unique();
  },
});

export const verifierPatch = mutation({
  args: { verifierId: v.id("authVerifiers"), data: v.any() },
  handler: async (ctx, { verifierId, data }) => {
    await ctx.db.patch(verifierId, data);
  },
});

export const verifierDelete = mutation({
  args: { verifierId: v.id("authVerifiers") },
  handler: async (ctx, { verifierId }) => {
    await ctx.db.delete(verifierId);
  },
});

// Verification codes
export const verificationCodeGetByAccountId = query({
  args: { accountId: v.id("authAccounts") },
  handler: async (ctx, { accountId }) => {
    return await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", accountId))
      .unique();
  },
});

export const verificationCodeGetByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("authVerificationCodes")
      .withIndex("code", (q) => q.eq("code", code))
      .unique();
  },
});

export const verificationCodeCreate = mutation({
  args: {
    accountId: v.id("authAccounts"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("authVerificationCodes", args);
  },
});

export const verificationCodeDelete = mutation({
  args: { verificationCodeId: v.id("authVerificationCodes") },
  handler: async (ctx, { verificationCodeId }) => {
    await ctx.db.delete(verificationCodeId);
  },
});

// Refresh tokens
export const refreshTokenCreate = mutation({
  args: {
    sessionId: v.id("authSessions"),
    expirationTime: v.number(),
    parentRefreshTokenId: v.optional(v.id("authRefreshTokens")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("authRefreshTokens", args);
  },
});

export const refreshTokenGetById = query({
  args: { refreshTokenId: v.id("authRefreshTokens") },
  handler: async (ctx, { refreshTokenId }) => {
    return await ctx.db.get(refreshTokenId);
  },
});

export const refreshTokenPatch = mutation({
  args: { refreshTokenId: v.id("authRefreshTokens"), data: v.any() },
  handler: async (ctx, { refreshTokenId, data }) => {
    await ctx.db.patch(refreshTokenId, data);
  },
});

export const refreshTokenGetChildren = query({
  args: {
    sessionId: v.id("authSessions"),
    parentRefreshTokenId: v.id("authRefreshTokens"),
  },
  handler: async (ctx, { sessionId, parentRefreshTokenId }) => {
    return await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q
          .eq("sessionId", sessionId)
          .eq("parentRefreshTokenId", parentRefreshTokenId),
      )
      .collect();
  },
});

export const refreshTokenListBySession = query({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q.eq("sessionId", sessionId),
      )
      .collect();
  },
});

export const refreshTokenDeleteAll = mutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q.eq("sessionId", sessionId),
      )
      .collect();
    await Promise.all(tokens.map((token) => ctx.db.delete(token._id)));
  },
});

export const refreshTokenGetActive = query({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
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
      .query("authRateLimits")
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
    return await ctx.db.insert("authRateLimits", args);
  },
});

export const rateLimitPatch = mutation({
  args: { rateLimitId: v.id("authRateLimits"), data: v.any() },
  handler: async (ctx, { rateLimitId, data }) => {
    await ctx.db.patch(rateLimitId, data);
  },
});

export const rateLimitDelete = mutation({
  args: { rateLimitId: v.id("authRateLimits") },
  handler: async (ctx, { rateLimitId }) => {
    await ctx.db.delete(rateLimitId);
  },
});
