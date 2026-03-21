import {
  mutation,
  query,
  v,
  vDeviceCodeDoc,
  vDeviceStatus,
  vPasskeyDoc,
  vRateLimitResult,
  vTotpFactorDoc,
} from "./shared";

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
