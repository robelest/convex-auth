import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./functions";

// ============================================================================
// Tag normalization helpers
// ============================================================================

/** Validator for a single `{ key, value }` tag pair. */
const vTag = v.object({ key: v.string(), value: v.string() });

const TABLES = {
  User: "User",
  Session: "Session",
  Account: "Account",
  AuthVerifier: "AuthVerifier",
  VerificationCode: "VerificationCode",
  RefreshToken: "RefreshToken",
  Passkey: "Passkey",
  TotpFactor: "TotpFactor",
  RateLimit: "RateLimit",
  Group: "Group",
  GroupTag: "GroupTag",
  GroupMember: "GroupMember",
  GroupInvite: "GroupInvite",
  ApiKey: "ApiKey",
  DeviceCode: "DeviceCode",
} as const;

const vInviteStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("revoked"),
  v.literal("expired"),
);

const vDeviceStatus = v.union(
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("denied"),
);

const vInviteTokenAcceptStatus = v.union(
  v.literal("accepted"),
  v.literal("already_accepted"),
);

const vMembershipStatus = v.union(
  v.literal("joined"),
  v.literal("already_joined"),
  v.literal("not_applicable"),
);

const vApiKeyScope = v.object({
  resource: v.string(),
  actions: v.array(v.string()),
});

const vApiKeyRateLimit = v.object({
  maxRequests: v.number(),
  windowMs: v.number(),
});

const vApiKeyRateLimitState = v.object({
  attemptsLeft: v.number(),
  lastAttemptTime: v.number(),
});

function vDocMeta<T extends (typeof TABLES)[keyof typeof TABLES]>(
  tableName: T,
) {
  return {
    _id: v.id(tableName),
    _creationTime: v.number(),
  };
}

const vUserDoc = v.object({
  ...vDocMeta(TABLES.User),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  extend: v.optional(v.any()),
});

const vSessionDoc = v.object({
  ...vDocMeta(TABLES.Session),
  userId: v.id(TABLES.User),
  expirationTime: v.number(),
});

const vAccountDoc = v.object({
  ...vDocMeta(TABLES.Account),
  userId: v.id(TABLES.User),
  provider: v.string(),
  providerAccountId: v.string(),
  secret: v.optional(v.string()),
  emailVerified: v.optional(v.string()),
  phoneVerified: v.optional(v.string()),
});

const vAuthVerifierDoc = v.object({
  ...vDocMeta(TABLES.AuthVerifier),
  sessionId: v.optional(v.id(TABLES.Session)),
  signature: v.optional(v.string()),
});

const vVerificationCodeDoc = v.object({
  ...vDocMeta(TABLES.VerificationCode),
  accountId: v.id(TABLES.Account),
  provider: v.string(),
  code: v.string(),
  expirationTime: v.number(),
  verifier: v.optional(v.string()),
  emailVerified: v.optional(v.string()),
  phoneVerified: v.optional(v.string()),
});

const vRefreshTokenDoc = v.object({
  ...vDocMeta(TABLES.RefreshToken),
  sessionId: v.id(TABLES.Session),
  expirationTime: v.number(),
  firstUsedTime: v.optional(v.number()),
  parentRefreshTokenId: v.optional(v.id(TABLES.RefreshToken)),
});

const vPasskeyDoc = v.object({
  ...vDocMeta(TABLES.Passkey),
  userId: v.id(TABLES.User),
  credentialId: v.string(),
  publicKey: v.bytes(),
  algorithm: v.number(),
  counter: v.number(),
  transports: v.optional(v.array(v.string())),
  deviceType: v.string(),
  backedUp: v.boolean(),
  name: v.optional(v.string()),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});

const vTotpFactorDoc = v.object({
  ...vDocMeta(TABLES.TotpFactor),
  userId: v.id(TABLES.User),
  secret: v.bytes(),
  digits: v.number(),
  period: v.number(),
  verified: v.boolean(),
  name: v.optional(v.string()),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});

const _vRateLimitDoc = v.object({
  ...vDocMeta(TABLES.RateLimit),
  identifier: v.string(),
  last_attempt_time: v.number(),
  attempts_left: v.number(),
});

const vGroupDoc = v.object({
  ...vDocMeta(TABLES.Group),
  name: v.string(),
  slug: v.optional(v.string()),
  type: v.optional(v.string()),
  parentGroupId: v.optional(v.id(TABLES.Group)),
  tags: v.optional(v.array(vTag)),
  extend: v.optional(v.any()),
});

const vGroupMemberDoc = v.object({
  ...vDocMeta(TABLES.GroupMember),
  groupId: v.id(TABLES.Group),
  userId: v.id(TABLES.User),
  role: v.optional(v.string()),
  status: v.optional(v.string()),
  extend: v.optional(v.any()),
});

const vGroupInviteDoc = v.object({
  ...vDocMeta(TABLES.GroupInvite),
  groupId: v.optional(v.id(TABLES.Group)),
  invitedByUserId: v.optional(v.id(TABLES.User)),
  email: v.optional(v.string()),
  tokenHash: v.string(),
  role: v.optional(v.string()),
  status: vInviteStatus,
  expiresTime: v.optional(v.number()),
  acceptedByUserId: v.optional(v.id(TABLES.User)),
  acceptedTime: v.optional(v.number()),
  extend: v.optional(v.any()),
});

const vApiKeyDoc = v.object({
  ...vDocMeta(TABLES.ApiKey),
  userId: v.id(TABLES.User),
  prefix: v.string(),
  hashedKey: v.string(),
  name: v.string(),
  scopes: v.array(vApiKeyScope),
  rateLimit: v.optional(vApiKeyRateLimit),
  rateLimitState: v.optional(vApiKeyRateLimitState),
  expiresAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  revoked: v.boolean(),
});

const vDeviceCodeDoc = v.object({
  ...vDocMeta(TABLES.DeviceCode),
  deviceCodeHash: v.string(),
  userCode: v.string(),
  expiresAt: v.number(),
  interval: v.number(),
  status: vDeviceStatus,
  userId: v.optional(v.id(TABLES.User)),
  sessionId: v.optional(v.id(TABLES.Session)),
  lastPolledAt: v.optional(v.number()),
});

const vRateLimitResult = v.object({
  ...vDocMeta(TABLES.RateLimit),
  identifier: v.string(),
  last_attempt_time: v.number(),
  attempts_left: v.number(),
  attemptsLeft: v.number(),
  lastAttemptTime: v.number(),
});

const vInviteAcceptByTokenResult = v.object({
  inviteId: v.id(TABLES.GroupInvite),
  groupId: v.union(v.id(TABLES.Group), v.null()),
  memberId: v.optional(v.id(TABLES.GroupMember)),
  inviteStatus: vInviteTokenAcceptStatus,
  membershipStatus: vMembershipStatus,
});

const vPaginated = (item: any) =>
  v.object({
    items: v.array(item),
    nextCursor: v.union(v.string(), v.null()),
  });

type TagPair = { key: string; value: string };

/** Normalize a single tag: trim + lowercase key and value. */
function normalizeTag(tag: TagPair): TagPair {
  return {
    key: tag.key.trim().toLowerCase(),
    value: tag.value.trim().toLowerCase(),
  };
}

/**
 * Normalize and deduplicate an array of tags.
 * Deduplication is based on the normalized `key\0value` composite.
 */
function normalizeTags(tags: TagPair[]): TagPair[] {
  const seen = new Set<string>();
  const result: TagPair[] = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    const composite = `${t.key}\0${t.value}`;
    if (!seen.has(composite)) {
      seen.add(composite);
      result.push(t);
    }
  }
  return result;
}

// ============================================================================
// Users
// ============================================================================

/**
 * List users with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }` — pass `nextCursor` back as `cursor`
 * for the next page, or `null` when exhausted.
 */
export const userList = query({
  args: {
    where: v.optional(
      v.object({
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        isAnonymous: v.optional(v.boolean()),
        name: v.optional(v.string()),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("email"),
        v.literal("phone"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vUserDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    // Pick index based on where fields
    let q;
    if (where.email !== undefined) {
      q = ctx.db
        .query("User")
        .withIndex("email", (idx) => idx.eq("email", where.email!));
    } else if (where.phone !== undefined) {
      q = ctx.db
        .query("User")
        .withIndex("phone", (idx) => idx.eq("phone", where.phone!));
    } else {
      q = ctx.db.query("User");
    }

    // Apply remaining filters
    if (where.isAnonymous !== undefined) {
      q = q.filter((f) => f.eq(f.field("isAnonymous"), where.isAnonymous!));
    }
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    // email/phone filters when not used as index
    if (where.email !== undefined && where.phone !== undefined) {
      q = q.filter((f) => f.eq(f.field("phone"), where.phone!));
    }

    q = q.order(order);

    // Cursor-based pagination: skip past the cursor ID
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

/** Retrieve a user by their document ID. */
export const userGetById = query({
  args: { userId: v.id("User") },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get("User", userId);
  },
});

/**
 * Find a user by their verified email address. Returns `null` if no user
 * has this email verified, or if multiple users share the same verified email
 * (ambiguous — should not happen in normal operation).
 */
export const userFindByVerifiedEmail = query({
  args: { email: v.string() },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { email }) => {
    const users = await ctx.db
      .query("User")
      .withIndex("email", (q) => q.eq("email", email))
      .filter((q) => q.neq(q.field("emailVerificationTime"), undefined))
      .take(2);
    return users.length === 1 ? users[0] : null;
  },
});

/**
 * Find a user by their verified phone number. Returns `null` if no user
 * has this phone verified, or if multiple users share the same verified phone
 * (ambiguous — should not happen in normal operation).
 */
export const userFindByVerifiedPhone = query({
  args: { phone: v.string() },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { phone }) => {
    const users = await ctx.db
      .query("User")
      .withIndex("phone", (q) => q.eq("phone", phone))
      .filter((q) => q.neq(q.field("phoneVerificationTime"), undefined))
      .take(2);
    return users.length === 1 ? users[0] : null;
  },
});

/** Insert a new user document. */
export const userInsert = mutation({
  args: { data: v.any() },
  returns: v.id("User"),
  handler: async (ctx, { data }) => {
    return await ctx.db.insert("User", data);
  },
});

/** Insert a new user or update an existing one. */
export const userUpsert = mutation({
  args: { userId: v.optional(v.id("User")), data: v.any() },
  returns: v.id("User"),
  handler: async (ctx, { userId, data }) => {
    if (userId !== undefined) {
      await ctx.db.patch("User", userId, data);
      return userId;
    }
    return await ctx.db.insert("User", data);
  },
});

/** Patch an existing user document with partial data. */
export const userPatch = mutation({
  args: { userId: v.id("User"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { userId, data }) => {
    await ctx.db.patch("User", userId, data);
    return null;
  },
});

// ============================================================================
// Accounts
// ============================================================================

/** List all accounts for a user. */
export const accountListByUser = query({
  args: { userId: v.id("User") },
  returns: v.array(vAccountDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Account")
      .withIndex("user_id_provider", (q) => q.eq("userId", userId as any))
      .collect();
  },
});

/** Look up an account by provider and provider-specific account ID. */
export const accountGet = query({
  args: { provider: v.string(), providerAccountId: v.string() },
  returns: v.union(vAccountDoc, v.null()),
  handler: async (ctx, { provider, providerAccountId }) => {
    return await ctx.db
      .query("Account")
      .withIndex("provider_account_id", (q) =>
        q.eq("provider", provider).eq("providerAccountId", providerAccountId),
      )
      .unique();
  },
});

/** Retrieve an account by its document ID. */
export const accountGetById = query({
  args: { accountId: v.id("Account") },
  returns: v.union(vAccountDoc, v.null()),
  handler: async (ctx, { accountId }) => {
    return await ctx.db.get("Account", accountId);
  },
});

/** Create a new account linking a user to an auth provider. */
export const accountInsert = mutation({
  args: {
    userId: v.id("User"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
  },
  returns: v.id("Account"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("Account", args as any);
  },
});

/** Patch an existing account document with partial data. */
export const accountPatch = mutation({
  args: { accountId: v.id("Account"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { accountId, data }) => {
    await ctx.db.patch("Account", accountId, data);
    return null;
  },
});

/** Delete an account document. */
export const accountDelete = mutation({
  args: { accountId: v.id("Account") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await ctx.db.delete("Account", accountId);
    return null;
  },
});

// ============================================================================
// Sessions
// ============================================================================

/**
 * List sessions with optional filtering and pagination.
 *
 * Returns `{ items, nextCursor }`.
 */
export const sessionList = query({
  args: {
    where: v.optional(
      v.object({
        userId: v.optional(v.id("User")),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vSessionDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.userId !== undefined) {
      q = ctx.db
        .query("Session")
        .withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
    } else {
      q = ctx.db.query("Session");
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

/** Create a new session for a user with an expiration time. */
export const sessionCreate = mutation({
  args: { userId: v.id("User"), expirationTime: v.number() },
  returns: v.id("Session"),
  handler: async (ctx, { userId, expirationTime }) => {
    return await ctx.db.insert("Session", {
      userId: userId as any,
      expirationTime,
    });
  },
});

/** Retrieve a session by its document ID. */
export const sessionGetById = query({
  args: { sessionId: v.id("Session") },
  returns: v.union(vSessionDoc, v.null()),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get("Session", sessionId);
  },
});

/** Delete a session. No-op if the session does not exist. */
export const sessionDelete = mutation({
  args: { sessionId: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    if ((await ctx.db.get("Session", sessionId)) !== null) {
      await ctx.db.delete("Session", sessionId);
    }
    return null;
  },
});

/** List all sessions for a user. */
export const sessionListByUser = query({
  args: { userId: v.id("User") },
  returns: v.array(vSessionDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Session")
      .withIndex("user_id", (q) => q.eq("userId", userId as any))
      .collect();
  },
});

// ============================================================================
// Verifiers
// ============================================================================

/** Create a new PKCE verifier, optionally linked to a session. */
export const verifierCreate = mutation({
  args: { sessionId: v.optional(v.id("Session")) },
  returns: v.id("AuthVerifier"),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.insert("AuthVerifier", { sessionId: sessionId as any });
  },
});

/** Retrieve a verifier by its document ID. */
export const verifierGetById = query({
  args: { verifierId: v.id("AuthVerifier") },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, { verifierId }) => {
    return await ctx.db.get("AuthVerifier", verifierId);
  },
});

/** Look up a verifier by its cryptographic signature. */
export const verifierGetBySignature = query({
  args: { signature: v.string() },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, { signature }) => {
    return await ctx.db
      .query("AuthVerifier")
      .withIndex("signature", (q) => q.eq("signature", signature))
      .unique();
  },
});

/** Patch a verifier document with partial data. */
export const verifierPatch = mutation({
  args: { verifierId: v.id("AuthVerifier"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { verifierId, data }) => {
    await ctx.db.patch("AuthVerifier", verifierId, data);
    return null;
  },
});

/** Delete a verifier document. */
export const verifierDelete = mutation({
  args: { verifierId: v.id("AuthVerifier") },
  returns: v.null(),
  handler: async (ctx, { verifierId }) => {
    await ctx.db.delete("AuthVerifier", verifierId);
    return null;
  },
});

// ============================================================================
// Verification Codes
// ============================================================================

/** Find a verification code by its associated account ID. */
export const verificationCodeGetByAccountId = query({
  args: { accountId: v.id("Account") },
  returns: v.union(vVerificationCodeDoc, v.null()),
  handler: async (ctx, { accountId }) => {
    return await ctx.db
      .query("VerificationCode")
      .withIndex("account_id", (q) => q.eq("accountId", accountId as any))
      .unique();
  },
});

/** Find a verification code by its code string. */
export const verificationCodeGetByCode = query({
  args: { code: v.string() },
  returns: v.union(vVerificationCodeDoc, v.null()),
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("VerificationCode")
      .withIndex("code", (q) => q.eq("code", code))
      .unique();
  },
});

/** Create a new verification code for OTP, magic link, or OAuth flows. */
export const verificationCodeCreate = mutation({
  args: {
    accountId: v.id("Account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  },
  returns: v.id("VerificationCode"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("VerificationCode", args as any);
  },
});

/** Delete a verification code document. */
export const verificationCodeDelete = mutation({
  args: { verificationCodeId: v.id("VerificationCode") },
  returns: v.null(),
  handler: async (ctx, { verificationCodeId }) => {
    await ctx.db.delete("VerificationCode", verificationCodeId);
    return null;
  },
});

// ============================================================================
// Refresh Tokens
// ============================================================================

/** Create a new refresh token for a session. */
export const refreshTokenCreate = mutation({
  args: {
    sessionId: v.id("Session"),
    expirationTime: v.number(),
    parentRefreshTokenId: v.optional(v.id("RefreshToken")),
  },
  returns: v.id("RefreshToken"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("RefreshToken", args as any);
  },
});

/** Retrieve a refresh token by its document ID. */
export const refreshTokenGetById = query({
  args: { refreshTokenId: v.id("RefreshToken") },
  returns: v.union(vRefreshTokenDoc, v.null()),
  handler: async (ctx, { refreshTokenId }) => {
    return await ctx.db.get("RefreshToken", refreshTokenId);
  },
});

/** Patch a refresh token document with partial data. */
export const refreshTokenPatch = mutation({
  args: { refreshTokenId: v.id("RefreshToken"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { refreshTokenId, data }) => {
    await ctx.db.patch("RefreshToken", refreshTokenId, data);
    return null;
  },
});

/** Get child tokens that were created by exchanging a specific parent token. */
export const refreshTokenGetChildren = query({
  args: {
    sessionId: v.id("Session"),
    parentRefreshTokenId: v.id("RefreshToken"),
  },
  returns: v.array(vRefreshTokenDoc),
  handler: async (ctx, { sessionId, parentRefreshTokenId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q
          .eq("sessionId", sessionId as any)
          .eq("parentRefreshTokenId", parentRefreshTokenId as any),
      )
      .collect();
  },
});

/** List all refresh tokens for a session. */
export const refreshTokenListBySession = query({
  args: { sessionId: v.id("Session") },
  returns: v.array(vRefreshTokenDoc),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q.eq("sessionId", sessionId as any),
      )
      .collect();
  },
});

/** Delete all refresh tokens for a session. */
export const refreshTokenDeleteAll = mutation({
  args: { sessionId: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const tokens = await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q.eq("sessionId", sessionId as any),
      )
      .collect();
    await Promise.all(
      tokens.map((token) => ctx.db.delete("RefreshToken", token._id)),
    );
    return null;
  },
});

/** Get the active (unused) refresh token for a session. */
export const refreshTokenGetActive = query({
  args: { sessionId: v.id("Session") },
  returns: v.union(vRefreshTokenDoc, v.null()),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id", (q) => q.eq("sessionId", sessionId as any))
      .filter((q) => q.eq(q.field("firstUsedTime"), undefined))
      .order("desc")
      .first();
  },
});

// ============================================================================
// Passkeys
// ============================================================================

/** Store a new passkey credential for a user. */
export const passkeyInsert = mutation({
  args: {
    userId: v.id("User"),
    credentialId: v.string(),
    publicKey: v.bytes(),
    algorithm: v.number(),
    counter: v.number(),
    transports: v.optional(v.array(v.string())),
    deviceType: v.string(),
    backedUp: v.boolean(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("Passkey"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("Passkey", args);
  },
});

/** Look up a passkey by its credential ID. */
export const passkeyGetByCredentialId = query({
  args: { credentialId: v.string() },
  returns: v.union(vPasskeyDoc, v.null()),
  handler: async (ctx, { credentialId }) => {
    return await ctx.db
      .query("Passkey")
      .withIndex("credential_id", (q) => q.eq("credentialId", credentialId))
      .unique();
  },
});

/** List all passkeys for a user. */
export const passkeyListByUserId = query({
  args: { userId: v.id("User") },
  returns: v.array(vPasskeyDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Passkey")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Update a passkey's counter and last used timestamp after authentication. */
export const passkeyUpdateCounter = mutation({
  args: {
    passkeyId: v.id("Passkey"),
    counter: v.number(),
    lastUsedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { passkeyId, counter, lastUsedAt }) => {
    await ctx.db.patch("Passkey", passkeyId, { counter, lastUsedAt });
    return null;
  },
});

/** Update a passkey's metadata (name). */
export const passkeyUpdateMeta = mutation({
  args: { passkeyId: v.id("Passkey"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { passkeyId, data }) => {
    await ctx.db.patch("Passkey", passkeyId, data);
    return null;
  },
});

/** Delete a passkey credential. */
export const passkeyDelete = mutation({
  args: { passkeyId: v.id("Passkey") },
  returns: v.null(),
  handler: async (ctx, { passkeyId }) => {
    await ctx.db.delete("Passkey", passkeyId);
    return null;
  },
});

// ============================================================================
// TOTP Two-Factor Authentication
// ============================================================================

/** Store a new TOTP enrollment for a user. */
export const totpInsert = mutation({
  args: {
    userId: v.id("User"),
    secret: v.bytes(),
    digits: v.number(),
    period: v.number(),
    verified: v.boolean(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("TotpFactor"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("TotpFactor", args);
  },
});

/** Get a verified TOTP enrollment for a user (returns first match). */
export const totpGetVerifiedByUserId = query({
  args: { userId: v.id("User") },
  returns: v.union(vTotpFactorDoc, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("TotpFactor")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("verified"), true))
      .first();
  },
});

/** List all TOTP enrollments for a user. */
export const totpListByUserId = query({
  args: { userId: v.id("User") },
  returns: v.array(vTotpFactorDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("TotpFactor")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Get a TOTP enrollment by its ID. */
export const totpGetById = query({
  args: { totpId: v.id("TotpFactor") },
  returns: v.union(vTotpFactorDoc, v.null()),
  handler: async (ctx, { totpId }) => {
    return await ctx.db.get("TotpFactor", totpId);
  },
});

/** Mark a TOTP enrollment as verified (setup complete). */
export const totpMarkVerified = mutation({
  args: { totpId: v.id("TotpFactor"), lastUsedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { totpId, lastUsedAt }) => {
    await ctx.db.patch("TotpFactor", totpId, { verified: true, lastUsedAt });
    return null;
  },
});

/** Update a TOTP enrollment's last used timestamp. */
export const totpUpdateLastUsed = mutation({
  args: { totpId: v.id("TotpFactor"), lastUsedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { totpId, lastUsedAt }) => {
    await ctx.db.patch("TotpFactor", totpId, { lastUsedAt });
    return null;
  },
});

/** Delete a TOTP enrollment. */
export const totpDelete = mutation({
  args: { totpId: v.id("TotpFactor") },
  returns: v.null(),
  handler: async (ctx, { totpId }) => {
    await ctx.db.delete("TotpFactor", totpId);
    return null;
  },
});

// ============================================================================
// Rate Limits
// ============================================================================

/** Look up a rate limit entry by its identifier. */
export const rateLimitGet = query({
  args: { identifier: v.string() },
  returns: v.union(vRateLimitResult, v.null()),
  handler: async (ctx, { identifier }) => {
    const row = await ctx.db
      .query("RateLimit")
      .withIndex("by_identifier", (q) => q.eq("identifier", identifier))
      .unique();
    if (row === null) {
      return null;
    }
    return {
      ...row,
      attemptsLeft: row.attempts_left,
      lastAttemptTime: row.last_attempt_time,
    };
  },
});

/** Create a new rate limit entry. */
export const rateLimitCreate = mutation({
  args: {
    identifier: v.string(),
    attemptsLeft: v.number(),
    lastAttemptTime: v.number(),
  },
  returns: v.id("RateLimit"),
  handler: async (ctx, { identifier, attemptsLeft, lastAttemptTime }) => {
    return await ctx.db.insert("RateLimit", {
      identifier,
      attempts_left: attemptsLeft,
      last_attempt_time: lastAttemptTime,
    });
  },
});

/** Patch a rate limit entry with partial data. */
export const rateLimitPatch = mutation({
  args: { rateLimitId: v.id("RateLimit"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { rateLimitId, data }) => {
    const nextData: Record<string, unknown> = { ...data };
    if (nextData.attemptsLeft !== undefined) {
      nextData.attempts_left = nextData.attemptsLeft;
      delete nextData.attemptsLeft;
    }
    if (nextData.lastAttemptTime !== undefined) {
      nextData.last_attempt_time = nextData.lastAttemptTime;
      delete nextData.lastAttemptTime;
    }
    await ctx.db.patch("RateLimit", rateLimitId, nextData);
    return null;
  },
});

/** Delete a rate limit entry. */
export const rateLimitDelete = mutation({
  args: { rateLimitId: v.id("RateLimit") },
  returns: v.null(),
  handler: async (ctx, { rateLimitId }) => {
    await ctx.db.delete("RateLimit", rateLimitId);
    return null;
  },
});

// ============================================================================
// Groups
// ============================================================================

/**
 * Create a new group. Groups are hierarchical — set `parentGroupId` to nest
 * under an existing group, or omit it to create a root-level group.
 *
 * @returns The ID of the newly created group.
 */
export const groupCreate = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    type: v.optional(v.string()),
    parentGroupId: v.optional(v.id("Group")),
    tags: v.optional(v.array(vTag)),
    extend: v.optional(v.any()),
  },
  returns: v.id("Group"),
  handler: async (ctx, args) => {
    const { tags: rawTags, ...rest } = args;
    const normalizedTags = rawTags ? normalizeTags(rawTags) : undefined;
    const groupId = await ctx.db.insert("Group", {
      ...rest,
      tags: normalizedTags,
    });
    // Sync companion group_tag rows
    if (normalizedTags) {
      for (const tag of normalizedTags) {
        await ctx.db.insert("GroupTag", {
          group_id: groupId,
          key: tag.key,
          value: tag.value,
        });
      }
    }
    return groupId;
  },
});

/** Retrieve a group by its document ID. Returns `null` if not found. */
export const groupGet = query({
  args: { groupId: v.id("Group") },
  returns: v.union(vGroupDoc, v.null()),
  handler: async (ctx, { groupId }) => {
    return await ctx.db.get("Group", groupId);
  },
});

/**
 * List groups with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Empty `where` returns **all** groups.
 */
export const groupList = query({
  args: {
    where: v.optional(
      v.object({
        slug: v.optional(v.string()),
        type: v.optional(v.string()),
        parentGroupId: v.optional(v.id("Group")),
        name: v.optional(v.string()),
        isRoot: v.optional(v.boolean()),
        tagsAll: v.optional(v.array(vTag)),
        tagsAny: v.optional(v.array(vTag)),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("slug"),
        v.literal("type"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    // ---- Resolve tag filters into a Set<Id<"Group">> ----
    let tagFilteredIds: Set<string> | null = null;

    if (where.tagsAll && where.tagsAll.length > 0) {
      // Intersect: group must have ALL specified tags
      let allSet: Set<string> | null = null;
      for (const rawTag of where.tagsAll) {
        const t = normalizeTag(rawTag);
        const rows = await ctx.db
          .query("GroupTag")
          .withIndex("by_key_value", (idx) =>
            idx.eq("key", t.key).eq("value", t.value),
          )
          .collect();
        const ids = new Set(rows.map((r) => r.group_id as string));
        if (allSet === null) {
          allSet = ids;
        } else {
          // Intersect
          for (const id of allSet) {
            if (!ids.has(id)) allSet.delete(id);
          }
        }
        // Short-circuit: empty intersection
        if (allSet.size === 0) break;
      }
      tagFilteredIds = allSet ?? new Set();
    }

    if (where.tagsAny && where.tagsAny.length > 0) {
      // Union: group must have at least one of the specified tags
      const anySet = new Set<string>();
      for (const rawTag of where.tagsAny) {
        const t = normalizeTag(rawTag);
        const rows = await ctx.db
          .query("GroupTag")
          .withIndex("by_key_value", (idx) =>
            idx.eq("key", t.key).eq("value", t.value),
          )
          .collect();
        for (const r of rows) {
          anySet.add(r.group_id as string);
        }
      }
      if (tagFilteredIds !== null) {
        // AND with tagsAll result
        for (const id of tagFilteredIds) {
          if (!anySet.has(id)) tagFilteredIds.delete(id);
        }
      } else {
        tagFilteredIds = anySet;
      }
    }

    // ---- Pick best index based on non-tag where fields ----
    let q;
    if (where.type !== undefined && where.parentGroupId !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("type_parent_group_id", (idx) =>
          idx.eq("type", where.type!).eq("parentGroupId", where.parentGroupId!),
        );
    } else if (where.slug !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("slug", (idx) => idx.eq("slug", where.slug!));
    } else if (where.type !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("type", (idx) => idx.eq("type", where.type!));
    } else if (where.parentGroupId !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("parent_group_id", (idx) =>
          idx.eq("parentGroupId", where.parentGroupId!),
        );
    } else {
      q = ctx.db.query("Group");
    }

    // Apply remaining non-tag filters not covered by index
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    if (where.isRoot === true) {
      q = q.filter((f) => f.eq(f.field("parentGroupId"), undefined));
    } else if (where.isRoot === false) {
      q = q.filter((f) => f.neq(f.field("parentGroupId"), undefined));
    }
    // slug filter when not used as index
    if (where.slug !== undefined && where.type !== undefined) {
      q = q.filter((f) => f.eq(f.field("slug"), where.slug!));
    }

    q = q.order(order);

    let all = await q.collect();

    // Apply tag filter (intersect with resolved groupIds)
    if (tagFilteredIds !== null) {
      all = all.filter((doc) => tagFilteredIds!.has(doc._id as string));
    }

    // Cursor-based pagination
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

/** Update a group's fields (name, slug, tags, extend, parentGroupId). */
export const groupUpdate = mutation({
  args: { groupId: v.id("Group"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { groupId, data }) => {
    // If tags are being updated, normalize and replace the full tag set
    if (data.tags !== undefined) {
      const normalizedTags: TagPair[] = Array.isArray(data.tags)
        ? normalizeTags(data.tags as TagPair[])
        : [];
      // Delete existing group_tag rows for this group
      const existingTags = await ctx.db
        .query("GroupTag")
        .withIndex("by_group", (idx) => idx.eq("group_id", groupId))
        .collect();
      for (const existing of existingTags) {
        await ctx.db.delete("GroupTag", existing._id);
      }
      // Insert new normalized group_tag rows
      for (const tag of normalizedTags) {
        await ctx.db.insert("GroupTag", {
          group_id: groupId,
          key: tag.key,
          value: tag.value,
        });
      }
      // Patch group with normalized tags (empty array = clear all)
      await ctx.db.patch("Group", groupId, {
        ...data,
        tags: normalizedTags.length > 0 ? normalizedTags : undefined,
      });
    } else {
      await ctx.db.patch("Group", groupId, data);
    }
    return null;
  },
});

/**
 * Delete a group and all of its descendants. This cascades to:
 * - All child groups (recursively)
 * - All members of this group and its descendants
 * - All invites for this group and its descendants
 */
export const groupDelete = mutation({
  args: { groupId: v.id("Group") },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const deleteGroup = async (id: typeof groupId) => {
      const children = await ctx.db
        .query("Group")
        .withIndex("parent_group_id", (q) => q.eq("parentGroupId", id))
        .collect();
      for (const child of children) {
        await deleteGroup(child._id);
      }

      const members = await ctx.db
        .query("GroupMember")
        .withIndex("group_id", (q) => q.eq("groupId", id))
        .collect();
      for (const member of members) {
        await ctx.db.delete("GroupMember", member._id);
      }

      const invites = await ctx.db
        .query("GroupInvite")
        .withIndex("group_id", (q) => q.eq("groupId", id))
        .collect();
      for (const invite of invites) {
        await ctx.db.delete("GroupInvite", invite._id);
      }

      // Delete companion group_tag rows
      const tags = await ctx.db
        .query("GroupTag")
        .withIndex("by_group", (q) => q.eq("group_id", id))
        .collect();
      for (const tag of tags) {
        await ctx.db.delete("GroupTag", tag._id);
      }

      await ctx.db.delete("Group", id);
    };

    await deleteGroup(groupId);
    return null;
  },
});

// ============================================================================
// Members
// ============================================================================

/**
 * Add a user as a member of a group.
 *
 * The `role` field is an application-defined string (e.g. "owner", "admin",
 * "member", "viewer"). The auth component stores it but does not enforce
 * access control — your application defines what each role means.
 *
 * Throws `ConvexError` with code `DUPLICATE_MEMBERSHIP` when the user is
 * already a member of the target group.
 *
 * @returns The ID of the new member record.
 */
export const memberAdd = mutation({
  args: {
    groupId: v.id("Group"),
    userId: v.id("User"),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupMember"),
  handler: async (ctx, args) => {
    const existingMembership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId),
      )
      .unique();
    if (existingMembership !== null) {
      throw new ConvexError({
        code: "DUPLICATE_MEMBERSHIP",
        message: "User is already a member of this group",
        groupId: args.groupId,
        userId: args.userId,
        existingMemberId: existingMembership._id,
      });
    }
    return await ctx.db.insert("GroupMember", args);
  },
});

/** Retrieve a member record by its document ID. Returns `null` if not found. */
export const memberGet = query({
  args: { memberId: v.id("GroupMember") },
  returns: v.union(vGroupMemberDoc, v.null()),
  handler: async (ctx, { memberId }) => {
    return await ctx.db.get("GroupMember", memberId);
  },
});

/**
 * List members with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `groupId`,
 * `userId`, `role`, and `status`.
 */
export const memberList = query({
  args: {
    where: v.optional(
      v.object({
        groupId: v.optional(v.id("Group")),
        userId: v.optional(v.id("User")),
        role: v.optional(v.string()),
        status: v.optional(v.string()),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("role"),
        v.literal("status"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupMemberDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.groupId !== undefined && where.userId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (idx) =>
          idx.eq("groupId", where.groupId!).eq("userId", where.userId!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.userId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
    } else {
      q = ctx.db.query("GroupMember");
    }

    if (where.role !== undefined) {
      q = q.filter((f) => f.eq(f.field("role"), where.role!));
    }
    if (where.status !== undefined) {
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

/**
 * @deprecated Use `memberList` with `where: { userId }` instead.
 * Kept for backward compatibility with generated component types.
 */
export const memberListByUser = query({
  args: { userId: v.id("User") },
  returns: v.array(vGroupMemberDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("GroupMember")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Look up a specific user's membership in a specific group.
 * Returns `null` if the user is not a member of the group.
 */
export const memberGetByGroupAndUser = query({
  args: { groupId: v.id("Group"), userId: v.id("User") },
  returns: v.union(vGroupMemberDoc, v.null()),
  handler: async (ctx, { groupId, userId }) => {
    return await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .unique();
  },
});

/** Remove a member from a group by deleting the member record. */
export const memberRemove = mutation({
  args: { memberId: v.id("GroupMember") },
  returns: v.null(),
  handler: async (ctx, { memberId }) => {
    await ctx.db.delete("GroupMember", memberId);
    return null;
  },
});

/**
 * Update a member record's fields (role, status, extend).
 *
 * Common usage: `memberUpdate({ memberId, data: { role: "admin" } })`
 */
export const memberUpdate = mutation({
  args: { memberId: v.id("GroupMember"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { memberId, data }) => {
    await ctx.db.patch("GroupMember", memberId, data);
    return null;
  },
});

// ============================================================================
// Invites
// ============================================================================

/**
 * Create a new platform-level invitation. Optionally set `groupId` to tie
 * the invite to a specific group. The invitation is sent to an email address
 * and includes a hashed token for secure acceptance.
 *
 * Throws `ConvexError` with code `DUPLICATE_INVITE` when a pending invite
 * already exists for the same email and scope:
 * - group invite: same `email` + same `groupId`
 * - platform invite: same `email` with no `groupId`
 *
 * @returns The ID of the new invite record.
 */
export const inviteCreate = mutation({
  args: {
    groupId: v.optional(v.id("Group")),
    invitedByUserId: v.optional(v.id("User")),
    email: v.optional(v.string()),
    tokenHash: v.string(),
    role: v.optional(v.string()),
    status: vInviteStatus,
    expiresTime: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupInvite"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Only check for duplicates when an email is provided.
    // CLI-generated invites (no email) are always allowed.
    if (args.email !== undefined) {
      if (args.groupId !== undefined) {
        const existingGroupInvites = await ctx.db
          .query("GroupInvite")
          .withIndex("group_id_status", (q) =>
            q.eq("groupId", args.groupId).eq("status", "pending"),
          )
          .filter((q) => q.eq(q.field("email"), args.email))
          .collect();

        for (const existingGroupInvite of existingGroupInvites) {
          const isExpired =
            existingGroupInvite.expiresTime !== undefined &&
            existingGroupInvite.expiresTime <= now;
          if (isExpired) {
            await ctx.db.patch("GroupInvite", existingGroupInvite._id, {
              status: "expired",
            });
            continue;
          }
          throw new ConvexError({
            code: "DUPLICATE_INVITE",
            message:
              "A pending invite already exists for this email in this group",
            email: args.email,
            groupId: args.groupId,
            existingInviteId: existingGroupInvite._id,
          });
        }
      } else {
        const existingPlatformInvites = await ctx.db
          .query("GroupInvite")
          .withIndex("email_status", (q) =>
            q.eq("email", args.email).eq("status", "pending"),
          )
          .filter((q) => q.eq(q.field("groupId"), undefined))
          .collect();

        for (const existingPlatformInvite of existingPlatformInvites) {
          const isExpired =
            existingPlatformInvite.expiresTime !== undefined &&
            existingPlatformInvite.expiresTime <= now;
          if (isExpired) {
            await ctx.db.patch("GroupInvite", existingPlatformInvite._id, {
              status: "expired",
            });
            continue;
          }
          throw new ConvexError({
            code: "DUPLICATE_INVITE",
            message: "A pending platform invite already exists for this email",
            email: args.email,
            existingInviteId: existingPlatformInvite._id,
          });
        }
      }
    }
    return await ctx.db.insert("GroupInvite", args);
  },
});

/** Retrieve an invite by its document ID. Returns `null` if not found. */
export const inviteGet = query({
  args: { inviteId: v.id("GroupInvite") },
  returns: v.union(vGroupInviteDoc, v.null()),
  handler: async (ctx, { inviteId }) => {
    return await ctx.db.get("GroupInvite", inviteId);
  },
});

/** Retrieve an invite by hashed token. Returns `null` if not found. */
export const inviteGetByTokenHash = query({
  args: { tokenHash: v.string() },
  returns: v.union(vGroupInviteDoc, v.null()),
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("GroupInvite")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
  },
});

/**
 * List invites with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `groupId`,
 * `status`, `email`, `invitedByUserId`, `role`, `acceptedByUserId`, and `tokenHash`.
 */
export const inviteList = query({
  args: {
    where: v.optional(
      v.object({
        tokenHash: v.optional(v.string()),
        groupId: v.optional(v.id("Group")),
        status: v.optional(vInviteStatus),
        email: v.optional(v.string()),
        invitedByUserId: v.optional(v.id("User")),
        role: v.optional(v.string()),
        acceptedByUserId: v.optional(v.id("User")),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("status"),
        v.literal("email"),
        v.literal("expiresTime"),
        v.literal("acceptedTime"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupInviteDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    // Pick best index
    let q;
    if (where.tokenHash !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("token_hash", (idx) =>
          idx.eq("tokenHash", where.tokenHash!),
        );
    } else if (
      where.role !== undefined &&
      where.status !== undefined &&
      where.acceptedByUserId !== undefined
    ) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("role_status_accepted_by_user_id", (idx) =>
          idx
            .eq("role", where.role!)
            .eq("status", where.status!)
            .eq("acceptedByUserId", where.acceptedByUserId!),
        );
    } else if (where.groupId !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("group_id_status", (idx) =>
          idx.eq("groupId", where.groupId!).eq("status", where.status!),
        );
    } else if (where.email !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("email_status", (idx) =>
          idx.eq("email", where.email!).eq("status", where.status!),
        );
    } else if (
      where.invitedByUserId !== undefined &&
      where.status !== undefined
    ) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("invited_by_user_id_status", (idx) =>
          idx
            .eq("invitedByUserId", where.invitedByUserId!)
            .eq("status", where.status!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("GroupInvite");
    }

    // Apply remaining filters
    if (where.groupId !== undefined) {
      q = q.filter((f) => f.eq(f.field("groupId"), where.groupId!));
    }
    if (where.status !== undefined) {
      q = q.filter((f) => f.eq(f.field("status"), where.status!));
    }
    if (where.email !== undefined) {
      q = q.filter((f) => f.eq(f.field("email"), where.email!));
    }
    if (where.invitedByUserId !== undefined) {
      q = q.filter((f) =>
        f.eq(f.field("invitedByUserId"), where.invitedByUserId!),
      );
    }
    if (where.role !== undefined) {
      q = q.filter((f) => f.eq(f.field("role"), where.role!));
    }
    if (where.acceptedByUserId !== undefined) {
      q = q.filter((f) =>
        f.eq(f.field("acceptedByUserId"), where.acceptedByUserId!),
      );
    }
    if (where.tokenHash !== undefined) {
      q = q.filter((f) => f.eq(f.field("tokenHash"), where.tokenHash!));
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

/**
 * Accept a pending invitation.
 *
 * Marks the invite as "accepted" and records the acceptance timestamp.
 * Throws a structured `ConvexError` when the invite doesn't exist or is not
 * currently pending.
 *
 * The caller is responsible for creating the corresponding member record.
 */
export const inviteAccept = mutation({
  args: {
    inviteId: v.id("GroupInvite"),
    acceptedByUserId: v.optional(v.id("User")),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId, acceptedByUserId }) => {
    const invite = await ctx.db.get("GroupInvite", inviteId);
    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
        inviteId,
      });
    }
    if (invite.status !== "pending") {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot accept invite with status "${invite.status}"`,
        inviteId,
        currentStatus: invite.status,
      });
    }
    if (invite.expiresTime !== undefined && invite.expiresTime <= Date.now()) {
      await ctx.db.patch("GroupInvite", inviteId, {
        status: "expired",
      });
      throw new ConvexError({
        code: "INVITE_EXPIRED",
        message: "Invite has expired",
        inviteId,
      });
    }
    await ctx.db.patch("GroupInvite", inviteId, {
      status: "accepted",
      acceptedTime: Date.now(),
      ...(acceptedByUserId ? { acceptedByUserId } : {}),
    });
    return null;
  },
});

/**
 * Accept an invitation by raw token hash and atomically join group membership.
 *
 * Returns idempotent success when the invite was already accepted by the same
 * user. If the invite targets a group, this mutation also ensures membership.
 */
export const inviteAcceptByToken = mutation({
  args: {
    tokenHash: v.string(),
    acceptedByUserId: v.id("User"),
  },
  returns: vInviteAcceptByTokenResult,
  handler: async (ctx, { tokenHash, acceptedByUserId }) => {
    const invite = await ctx.db
      .query("GroupInvite")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
      });
    }

    const now = Date.now();
    if (invite.status === "pending") {
      if (invite.expiresTime !== undefined && invite.expiresTime <= now) {
        await ctx.db.patch("GroupInvite", invite._id, { status: "expired" });
        throw new ConvexError({
          code: "INVITE_EXPIRED",
          message: "Invite has expired",
          inviteId: invite._id,
        });
      }
    } else if (invite.status === "accepted") {
      if (invite.acceptedByUserId !== acceptedByUserId) {
        throw new ConvexError({
          code: "INVITE_ALREADY_ACCEPTED",
          message: "Invite already accepted by another user",
          inviteId: invite._id,
        });
      }
    } else {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot accept invite with status "${invite.status}"`,
        inviteId: invite._id,
        currentStatus: invite.status,
      });
    }

    if (invite.email !== undefined) {
      const user = await ctx.db.get("User", acceptedByUserId);
      const normalizedInviteEmail = invite.email.trim().toLowerCase();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (
        normalizedUserEmail === undefined ||
        normalizedUserEmail !== normalizedInviteEmail
      ) {
        throw new ConvexError({
          code: "INVITE_EMAIL_MISMATCH",
          message: "Invite email does not match accepting user's email",
          inviteId: invite._id,
        });
      }
    }

    let membershipStatus: "joined" | "already_joined" | "not_applicable" =
      "not_applicable";
    let memberId: Id<"GroupMember"> | undefined;

    if (invite.groupId !== undefined) {
      const existingMembership = await ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (q) =>
          q.eq("groupId", invite.groupId!).eq("userId", acceptedByUserId),
        )
        .unique();

      if (existingMembership !== null) {
        membershipStatus = "already_joined";
        memberId = existingMembership._id;
      } else {
        memberId = await ctx.db.insert("GroupMember", {
          groupId: invite.groupId,
          userId: acceptedByUserId,
          role: invite.role,
          status: "active",
        });
        membershipStatus = "joined";
      }
    }

    if (invite.status === "pending") {
      await ctx.db.patch("GroupInvite", invite._id, {
        status: "accepted",
        acceptedByUserId,
        acceptedTime: now,
      });
    }

    const inviteStatus: "accepted" | "already_accepted" =
      invite.status === "accepted" ? "already_accepted" : "accepted";

    return {
      inviteId: invite._id,
      groupId: invite.groupId ?? null,
      memberId,
      inviteStatus,
      membershipStatus,
    };
  },
});

/**
 * Revoke a pending invitation.
 *
 * Marks the invite as "revoked". Throws a structured `ConvexError` when the
 * invite doesn't exist or is not currently pending.
 */
export const inviteRevoke = mutation({
  args: { inviteId: v.id("GroupInvite") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("GroupInvite", inviteId);
    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
        inviteId,
      });
    }
    if (invite.status !== "pending") {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot revoke invite with status "${invite.status}"`,
        inviteId,
        currentStatus: invite.status,
      });
    }
    await ctx.db.patch("GroupInvite", inviteId, { status: "revoked" });
    return null;
  },
});

// ============================================================================
// API Keys
// ============================================================================

/**
 * Insert a new API key record.
 *
 * The caller is responsible for hashing the raw key before passing it here —
 * this function only stores the hash and metadata.
 */
export const keyInsert = mutation({
  args: {
    userId: v.id("User"),
    prefix: v.string(),
    hashedKey: v.string(),
    name: v.string(),
    scopes: v.array(
      v.object({
        resource: v.string(),
        actions: v.array(v.string()),
      }),
    ),
    rateLimit: v.optional(vApiKeyRateLimit),
    expiresAt: v.optional(v.number()),
  },
  returns: v.id("ApiKey"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("ApiKey", {
      ...args,
      createdAt: Date.now(),
      revoked: false,
    });
  },
});

/**
 * Look up an API key by its SHA-256 hash.
 *
 * Used during Bearer token verification. Returns the full key record
 * (including rate limit state) or `null` if not found.
 */
export const keyGetByHashedKey = query({
  args: { hashedKey: v.string() },
  returns: v.union(vApiKeyDoc, v.null()),
  handler: async (ctx, { hashedKey }) => {
    return await ctx.db
      .query("ApiKey")
      .withIndex("hashed_key", (q) => q.eq("hashedKey", hashedKey))
      .first();
  },
});

/**
 * @deprecated Use `keyList` with `where: { userId }` instead.
 * Kept for backward compatibility with generated component types.
 */
export const keyListByUserId = query({
  args: { userId: v.id("User") },
  returns: v.array(vApiKeyDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("ApiKey")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * List API keys with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `userId`,
 * `revoked`, `name`, and `prefix`.
 */
export const keyList = query({
  args: {
    where: v.optional(
      v.object({
        userId: v.optional(v.id("User")),
        revoked: v.optional(v.boolean()),
        name: v.optional(v.string()),
        prefix: v.optional(v.string()),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("lastUsedAt"),
        v.literal("expiresAt"),
        v.literal("revoked"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vApiKeyDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.userId !== undefined) {
      q = ctx.db
        .query("ApiKey")
        .withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
    } else {
      q = ctx.db.query("ApiKey");
    }

    if (where.revoked !== undefined) {
      q = q.filter((f) => f.eq(f.field("revoked"), where.revoked!));
    }
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    if (where.prefix !== undefined) {
      q = q.filter((f) => f.eq(f.field("prefix"), where.prefix!));
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

/** Get a single API key by document ID. */
export const keyGetById = query({
  args: { keyId: v.id("ApiKey") },
  returns: v.union(vApiKeyDoc, v.null()),
  handler: async (ctx, { keyId }) => {
    return await ctx.db.get("ApiKey", keyId);
  },
});

/**
 * Patch an API key record. Used for updating name, scopes, rate limit config,
 * revocation, and lastUsedAt / rate limit state tracking.
 */
export const keyPatch = mutation({
  args: {
    keyId: v.id("ApiKey"),
    data: v.object({
      name: v.optional(v.string()),
      scopes: v.optional(v.array(vApiKeyScope)),
      rateLimit: v.optional(vApiKeyRateLimit),
      rateLimitState: v.optional(vApiKeyRateLimitState),
      revoked: v.optional(v.boolean()),
      lastUsedAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, data }) => {
    const key = await ctx.db.get("ApiKey", keyId);
    if (key === null) {
      throw new ConvexError({
        code: "KEY_NOT_FOUND",
        message: "API key not found",
        keyId,
      });
    }
    await ctx.db.patch("ApiKey", keyId, data);
    return null;
  },
});

/** Hard delete an API key record. */
export const keyDelete = mutation({
  args: { keyId: v.id("ApiKey") },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get("ApiKey", keyId);
    if (key === null) {
      throw new ConvexError({
        code: "KEY_NOT_FOUND",
        message: "API key not found",
        keyId,
      });
    }
    await ctx.db.delete("ApiKey", keyId);
    return null;
  },
});

// ============================================================================
// Device Authorization (RFC 8628)
// ============================================================================

/** Insert a new device authorization record. */
export const deviceInsert = mutation({
  args: {
    deviceCodeHash: v.string(),
    userCode: v.string(),
    expiresAt: v.number(),
    interval: v.number(),
    status: vDeviceStatus,
  },
  returns: v.id("DeviceCode"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("DeviceCode", args);
  },
});

/** Look up a device authorization by its hashed device code. */
export const deviceGetByCodeHash = query({
  args: { deviceCodeHash: v.string() },
  returns: v.union(vDeviceCodeDoc, v.null()),
  handler: async (ctx, { deviceCodeHash }) => {
    return await ctx.db
      .query("DeviceCode")
      .withIndex("device_code_hash", (q) =>
        q.eq("deviceCodeHash", deviceCodeHash),
      )
      .first();
  },
});

/** Look up a pending device authorization by its user code. */
export const deviceGetByUserCode = query({
  args: { userCode: v.string() },
  returns: v.union(vDeviceCodeDoc, v.null()),
  handler: async (ctx, { userCode }) => {
    return await ctx.db
      .query("DeviceCode")
      .withIndex("user_code_status", (q) =>
        q.eq("userCode", userCode).eq("status", "pending"),
      )
      .first();
  },
});

/** Authorize a device code — link it to a user and session. */
export const deviceAuthorize = mutation({
  args: {
    deviceId: v.id("DeviceCode"),
    userId: v.id("User"),
    sessionId: v.id("Session"),
  },
  returns: v.null(),
  handler: async (ctx, { deviceId, userId, sessionId }) => {
    await ctx.db.patch("DeviceCode", deviceId, {
      status: "authorized",
      userId,
      sessionId,
    });
    return null;
  },
});

/** Update the last-polled timestamp on a device authorization record. */
export const deviceUpdateLastPolled = mutation({
  args: { deviceId: v.id("DeviceCode"), lastPolledAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { deviceId, lastPolledAt }) => {
    await ctx.db.patch("DeviceCode", deviceId, { lastPolledAt });
    return null;
  },
});

/** Delete a device authorization record (cleanup after use or expiry). */
export const deviceDelete = mutation({
  args: { deviceId: v.id("DeviceCode") },
  returns: v.null(),
  handler: async (ctx, { deviceId }) => {
    await ctx.db.delete("DeviceCode", deviceId);
    return null;
  },
});
