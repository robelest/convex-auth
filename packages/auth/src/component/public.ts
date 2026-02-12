import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ============================================================================
// Users
// ============================================================================

/** Retrieve a user by their document ID. */
export const userGetById = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

/**
 * Find a user by their verified email address. Returns `null` if no user
 * has this email verified, or if multiple users share the same verified email
 * (ambiguous — should not happen in normal operation).
 */
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

/**
 * Find a user by their verified phone number. Returns `null` if no user
 * has this phone verified, or if multiple users share the same verified phone
 * (ambiguous — should not happen in normal operation).
 */
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

/** Insert a new user document. */
export const userInsert = mutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    return await ctx.db.insert("user", data);
  },
});

/** Insert a new user or update an existing one. */
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

/** Patch an existing user document with partial data. */
export const userPatch = mutation({
  args: { userId: v.id("user"), data: v.any() },
  handler: async (ctx, { userId, data }) => {
    await ctx.db.patch(userId, data);
  },
});

// ============================================================================
// Accounts
// ============================================================================

/** Look up an account by provider and provider-specific account ID. */
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

/** Retrieve an account by its document ID. */
export const accountGetById = query({
  args: { accountId: v.id("account") },
  handler: async (ctx, { accountId }) => {
    return await ctx.db.get(accountId);
  },
});

/** Create a new account linking a user to an auth provider. */
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

/** Patch an existing account document with partial data. */
export const accountPatch = mutation({
  args: { accountId: v.id("account"), data: v.any() },
  handler: async (ctx, { accountId, data }) => {
    await ctx.db.patch(accountId, data);
  },
});

/** Delete an account document. */
export const accountDelete = mutation({
  args: { accountId: v.id("account") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.delete(accountId);
  },
});

// ============================================================================
// Sessions
// ============================================================================

/** Create a new session for a user with an expiration time. */
export const sessionCreate = mutation({
  args: { userId: v.id("user"), expirationTime: v.number() },
  handler: async (ctx, { userId, expirationTime }) => {
    return await ctx.db.insert("session", {
      userId: userId as any,
      expirationTime,
    });
  },
});

/** Retrieve a session by its document ID. */
export const sessionGetById = query({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get(sessionId);
  },
});

/** Delete a session. No-op if the session does not exist. */
export const sessionDelete = mutation({
  args: { sessionId: v.id("session") },
  handler: async (ctx, { sessionId }) => {
    if ((await ctx.db.get(sessionId)) !== null) {
      await ctx.db.delete(sessionId);
    }
  },
});

/** List all sessions for a user. */
export const sessionListByUser = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("session")
      .withIndex("userId", (q) => q.eq("userId", userId as any))
      .collect();
  },
});

// ============================================================================
// Verifiers
// ============================================================================

/** Create a new PKCE verifier, optionally linked to a session. */
export const verifierCreate = mutation({
  args: { sessionId: v.optional(v.id("session")) },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.insert("verifier", { sessionId: sessionId as any });
  },
});

/** Retrieve a verifier by its document ID. */
export const verifierGetById = query({
  args: { verifierId: v.id("verifier") },
  handler: async (ctx, { verifierId }) => {
    return await ctx.db.get(verifierId);
  },
});

/** Look up a verifier by its cryptographic signature. */
export const verifierGetBySignature = query({
  args: { signature: v.string() },
  handler: async (ctx, { signature }) => {
    return await ctx.db
      .query("verifier")
      .withIndex("signature", (q) => q.eq("signature", signature))
      .unique();
  },
});

/** Patch a verifier document with partial data. */
export const verifierPatch = mutation({
  args: { verifierId: v.id("verifier"), data: v.any() },
  handler: async (ctx, { verifierId, data }) => {
    await ctx.db.patch(verifierId, data);
  },
});

/** Delete a verifier document. */
export const verifierDelete = mutation({
  args: { verifierId: v.id("verifier") },
  handler: async (ctx, { verifierId }) => {
    await ctx.db.delete(verifierId);
  },
});

// ============================================================================
// Verification Codes
// ============================================================================

/** Find a verification code by its associated account ID. */
export const verificationCodeGetByAccountId = query({
  args: { accountId: v.id("account") },
  handler: async (ctx, { accountId }) => {
    return await ctx.db
      .query("verification")
      .withIndex("accountId", (q) => q.eq("accountId", accountId as any))
      .unique();
  },
});

/** Find a verification code by its code string. */
export const verificationCodeGetByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("verification")
      .withIndex("code", (q) => q.eq("code", code))
      .unique();
  },
});

/** Create a new verification code for OTP, magic link, or OAuth flows. */
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

/** Delete a verification code document. */
export const verificationCodeDelete = mutation({
  args: { verificationCodeId: v.id("verification") },
  handler: async (ctx, { verificationCodeId }) => {
    await ctx.db.delete(verificationCodeId);
  },
});

// ============================================================================
// Refresh Tokens
// ============================================================================

/** Create a new refresh token for a session. */
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

/** Retrieve a refresh token by its document ID. */
export const refreshTokenGetById = query({
  args: { refreshTokenId: v.id("token") },
  handler: async (ctx, { refreshTokenId }) => {
    return await ctx.db.get(refreshTokenId);
  },
});

/** Patch a refresh token document with partial data. */
export const refreshTokenPatch = mutation({
  args: { refreshTokenId: v.id("token"), data: v.any() },
  handler: async (ctx, { refreshTokenId, data }) => {
    await ctx.db.patch(refreshTokenId, data);
  },
});

/** Get child tokens that were created by exchanging a specific parent token. */
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

/** List all refresh tokens for a session. */
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

/** Delete all refresh tokens for a session. */
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

/** Get the active (unused) refresh token for a session. */
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

// ============================================================================
// Passkeys
// ============================================================================

/** Store a new passkey credential for a user. */
export const passkeyInsert = mutation({
  args: {
    userId: v.id("user"),
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
  handler: async (ctx, args) => {
    return await ctx.db.insert("passkey", args);
  },
});

/** Look up a passkey by its credential ID. */
export const passkeyGetByCredentialId = query({
  args: { credentialId: v.string() },
  handler: async (ctx, { credentialId }) => {
    return await ctx.db
      .query("passkey")
      .withIndex("credentialId", (q) => q.eq("credentialId", credentialId))
      .unique();
  },
});

/** List all passkeys for a user. */
export const passkeyListByUserId = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("passkey")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Update a passkey's counter and last used timestamp after authentication. */
export const passkeyUpdateCounter = mutation({
  args: { passkeyId: v.id("passkey"), counter: v.number(), lastUsedAt: v.number() },
  handler: async (ctx, { passkeyId, counter, lastUsedAt }) => {
    await ctx.db.patch(passkeyId, { counter, lastUsedAt });
  },
});

/** Update a passkey's metadata (name). */
export const passkeyUpdateMeta = mutation({
  args: { passkeyId: v.id("passkey"), data: v.any() },
  handler: async (ctx, { passkeyId, data }) => {
    await ctx.db.patch(passkeyId, data);
  },
});

/** Delete a passkey credential. */
export const passkeyDelete = mutation({
  args: { passkeyId: v.id("passkey") },
  handler: async (ctx, { passkeyId }) => {
    await ctx.db.delete(passkeyId);
  },
});

// ============================================================================
// TOTP Two-Factor Authentication
// ============================================================================

/** Store a new TOTP enrollment for a user. */
export const totpInsert = mutation({
  args: {
    userId: v.id("user"),
    secret: v.bytes(),
    digits: v.number(),
    period: v.number(),
    verified: v.boolean(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("totp", args);
  },
});

/** Get a verified TOTP enrollment for a user (returns first match). */
export const totpGetVerifiedByUserId = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("totp")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("verified"), true))
      .first();
  },
});

/** List all TOTP enrollments for a user. */
export const totpListByUserId = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("totp")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Get a TOTP enrollment by its ID. */
export const totpGetById = query({
  args: { totpId: v.id("totp") },
  handler: async (ctx, { totpId }) => {
    return await ctx.db.get(totpId);
  },
});

/** Mark a TOTP enrollment as verified (setup complete). */
export const totpMarkVerified = mutation({
  args: { totpId: v.id("totp"), lastUsedAt: v.number() },
  handler: async (ctx, { totpId, lastUsedAt }) => {
    await ctx.db.patch(totpId, { verified: true, lastUsedAt });
  },
});

/** Update a TOTP enrollment's last used timestamp. */
export const totpUpdateLastUsed = mutation({
  args: { totpId: v.id("totp"), lastUsedAt: v.number() },
  handler: async (ctx, { totpId, lastUsedAt }) => {
    await ctx.db.patch(totpId, { lastUsedAt });
  },
});

/** Delete a TOTP enrollment. */
export const totpDelete = mutation({
  args: { totpId: v.id("totp") },
  handler: async (ctx, { totpId }) => {
    await ctx.db.delete(totpId);
  },
});

// ============================================================================
// Rate Limits
// ============================================================================

/** Look up a rate limit entry by its identifier. */
export const rateLimitGet = query({
  args: { identifier: v.string() },
  handler: async (ctx, { identifier }) => {
    return await ctx.db
      .query("limit")
      .withIndex("identifier", (q) => q.eq("identifier", identifier))
      .unique();
  },
});

/** Create a new rate limit entry. */
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

/** Patch a rate limit entry with partial data. */
export const rateLimitPatch = mutation({
  args: { rateLimitId: v.id("limit"), data: v.any() },
  handler: async (ctx, { rateLimitId, data }) => {
    await ctx.db.patch(rateLimitId, data);
  },
});

/** Delete a rate limit entry. */
export const rateLimitDelete = mutation({
  args: { rateLimitId: v.id("limit") },
  handler: async (ctx, { rateLimitId }) => {
    await ctx.db.delete(rateLimitId);
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
    parentGroupId: v.optional(v.id("group")),
    extend: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("group", args);
  },
});

/** Retrieve a group by its document ID. Returns `null` if not found. */
export const groupGet = query({
  args: { groupId: v.id("group") },
  handler: async (ctx, { groupId }) => {
    return await ctx.db.get(groupId);
  },
});

/**
 * List groups. When `parentGroupId` is provided, returns children of that
 * group. When omitted, returns all root-level groups (groups with no parent).
 */
export const groupList = query({
  args: { parentGroupId: v.optional(v.id("group")) },
  handler: async (ctx, { parentGroupId }) => {
    return await ctx.db
      .query("group")
      .withIndex("parentGroupId", (q) => q.eq("parentGroupId", parentGroupId))
      .collect();
  },
});

/** Update a group's fields (name, slug, extend, parentGroupId). */
export const groupUpdate = mutation({
  args: { groupId: v.id("group"), data: v.any() },
  handler: async (ctx, { groupId, data }) => {
    await ctx.db.patch(groupId, data);
  },
});

/**
 * Delete a group and all of its descendants. This cascades to:
 * - All child groups (recursively)
 * - All members of this group and its descendants
 * - All invites for this group and its descendants
 */
export const groupDelete = mutation({
  args: { groupId: v.id("group") },
  handler: async (ctx, { groupId }) => {
    const deleteGroup = async (id: typeof groupId) => {
      const children = await ctx.db
        .query("group")
        .withIndex("parentGroupId", (q) => q.eq("parentGroupId", id))
        .collect();
      for (const child of children) {
        await deleteGroup(child._id);
      }

      const members = await ctx.db
        .query("member")
        .withIndex("groupId", (q) => q.eq("groupId", id))
        .collect();
      for (const member of members) {
        await ctx.db.delete(member._id);
      }

      const invites = await ctx.db
        .query("invite")
        .withIndex("groupId", (q) => q.eq("groupId", id))
        .collect();
      for (const invite of invites) {
        await ctx.db.delete(invite._id);
      }

      await ctx.db.delete(id);
    };

    await deleteGroup(groupId);
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
    groupId: v.id("group"),
    userId: v.id("user"),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    extend: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existingMembership = await ctx.db
      .query("member")
      .withIndex("groupIdAndUserId", (q) =>
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
    return await ctx.db.insert("member", args);
  },
});

/** Retrieve a member record by its document ID. Returns `null` if not found. */
export const memberGet = query({
  args: { memberId: v.id("member") },
  handler: async (ctx, { memberId }) => {
    return await ctx.db.get(memberId);
  },
});

/** List all members of a specific group. */
export const memberList = query({
  args: { groupId: v.id("group") },
  handler: async (ctx, { groupId }) => {
    return await ctx.db
      .query("member")
      .withIndex("groupId", (q) => q.eq("groupId", groupId))
      .collect();
  },
});

/**
 * List all group memberships for a specific user. Returns member records
 * which include the `groupId`, `role`, `status`, and `extend` for each
 * group the user belongs to.
 */
export const memberListByUser = query({
  args: { userId: v.id("user") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("member")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Look up a specific user's membership in a specific group.
 * Returns `null` if the user is not a member of the group.
 */
export const memberGetByGroupAndUser = query({
  args: { groupId: v.id("group"), userId: v.id("user") },
  handler: async (ctx, { groupId, userId }) => {
    return await ctx.db
      .query("member")
      .withIndex("groupIdAndUserId", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .unique();
  },
});

/** Remove a member from a group by deleting the member record. */
export const memberRemove = mutation({
  args: { memberId: v.id("member") },
  handler: async (ctx, { memberId }) => {
    await ctx.db.delete(memberId);
  },
});

/**
 * Update a member record's fields (role, status, extend).
 *
 * Common usage: `memberUpdate({ memberId, data: { role: "admin" } })`
 */
export const memberUpdate = mutation({
  args: { memberId: v.id("member"), data: v.any() },
  handler: async (ctx, { memberId, data }) => {
    await ctx.db.patch(memberId, data);
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
    groupId: v.optional(v.id("group")),
    invitedByUserId: v.id("user"),
    email: v.string(),
    tokenHash: v.string(),
    role: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresTime: v.number(),
    extend: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.groupId !== undefined) {
      const existingGroupInvite = await ctx.db
        .query("invite")
        .withIndex("groupIdAndStatus", (q) =>
          q.eq("groupId", args.groupId).eq("status", "pending"),
        )
        .filter((q) => q.eq(q.field("email"), args.email))
        .first();
      if (existingGroupInvite !== null) {
        throw new ConvexError({
          code: "DUPLICATE_INVITE",
          message: "A pending invite already exists for this email in this group",
          email: args.email,
          groupId: args.groupId,
          existingInviteId: existingGroupInvite._id,
        });
      }
    } else {
      const existingPlatformInvite = await ctx.db
        .query("invite")
        .withIndex("emailAndStatus", (q) =>
          q.eq("email", args.email).eq("status", "pending"),
        )
        .filter((q) => q.eq(q.field("groupId"), undefined))
        .first();
      if (existingPlatformInvite !== null) {
        throw new ConvexError({
          code: "DUPLICATE_INVITE",
          message: "A pending platform invite already exists for this email",
          email: args.email,
          existingInviteId: existingPlatformInvite._id,
        });
      }
    }
    return await ctx.db.insert("invite", args);
  },
});

/** Retrieve an invite by its document ID. Returns `null` if not found. */
export const inviteGet = query({
  args: { inviteId: v.id("invite") },
  handler: async (ctx, { inviteId }) => {
    return await ctx.db.get(inviteId);
  },
});

/**
 * List invites, optionally filtered by group and/or status.
 * Both `groupId` and `status` are optional filters.
 */
export const inviteList = query({
  args: {
    groupId: v.optional(v.id("group")),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
    ),
  },
  handler: async (ctx, { groupId, status }) => {
    if (groupId !== undefined && status !== undefined) {
      return await ctx.db
        .query("invite")
        .withIndex("groupIdAndStatus", (q) =>
          q.eq("groupId", groupId).eq("status", status),
        )
        .collect();
    }
    if (groupId !== undefined) {
      return await ctx.db
        .query("invite")
        .withIndex("groupId", (q) => q.eq("groupId", groupId))
        .collect();
    }
    if (status !== undefined) {
      return await ctx.db
        .query("invite")
        .withIndex("status", (q) => q.eq("status", status))
        .collect();
    }
    return await ctx.db.query("invite").collect();
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
  args: { inviteId: v.id("invite") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
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
    await ctx.db.patch(inviteId, {
      status: "accepted",
      acceptedTime: Date.now(),
    });
  },
});

/**
 * Revoke a pending invitation.
 *
 * Marks the invite as "revoked". Throws a structured `ConvexError` when the
 * invite doesn't exist or is not currently pending.
 */
export const inviteRevoke = mutation({
  args: { inviteId: v.id("invite") },
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get(inviteId);
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
    await ctx.db.patch(inviteId, { status: "revoked" });
  },
});
