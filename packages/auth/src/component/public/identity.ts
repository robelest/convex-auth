import {
  mutation,
  query,
  v,
  vAccountDoc,
  vAuthVerifierDoc,
  vPaginated,
  vRefreshTokenDoc,
  vSessionDoc,
  vUserDoc,
  vVerificationCodeDoc,
} from "./shared";

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

/** Delete a user document by ID. No-op if the user does not exist. */
export const userDelete = mutation({
  args: { userId: v.id("User") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    if ((await ctx.db.get("User", userId)) !== null) {
      await ctx.db.delete("User", userId);
    }
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
    extend: v.optional(v.any()),
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
