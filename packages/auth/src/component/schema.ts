import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schema for the auth component.
 *
 * Contains tables for core authentication (users, sessions, accounts, tokens,
 * verification codes, PKCE verifiers, rate limits) and hierarchical group
 * management (groups, members, invites).
 */
export default defineSchema({
  /**
   * Authenticated users. A user may have multiple linked accounts
   * and multiple concurrent sessions.
   */
  user: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  /**
   * Active sessions. A single user can have multiple concurrent sessions
   * across different devices or browsers. Sessions expire after a
   * configurable duration.
   */
  session: defineTable({
    userId: v.id("user"),
    expirationTime: v.number(),
  }).index("userId", ["userId"]),

  /**
   * Authentication accounts. Each account links a user to a single
   * authentication provider (e.g. Google OAuth, email/password).
   * A user can have multiple accounts linked.
   */
  account: defineTable({
    userId: v.id("user"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index("userIdAndProvider", ["userId", "provider"])
    .index("providerAndAccountId", ["provider", "providerAccountId"]),

  /**
   * Refresh tokens for session continuity. Tokens are single-use and form
   * a chain — each token references the one it was exchanged from.
   *
   * The active refresh token is the most recently created token that has not
   * been used yet. A 10-second reuse window allows for concurrent requests.
   * Any invalid use of a token invalidates the entire chain.
   */
  token: defineTable({
    sessionId: v.id("session"),
    expirationTime: v.number(),
    firstUsedTime: v.optional(v.number()),
    parentRefreshTokenId: v.optional(v.id("token")),
  })
    .index("sessionId", ["sessionId"])
    .index("sessionIdAndParentRefreshTokenId", [
      "sessionId",
      "parentRefreshTokenId",
    ]),

  /**
   * Verification codes for OTP tokens, magic link tokens, and OAuth codes.
   */
  verification: defineTable({
    accountId: v.id("account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index("accountId", ["accountId"])
    .index("code", ["code"]),

  /**
   * PKCE verifiers for OAuth flows. Stores the cryptographic verifier
   * used to prove the authorization request originated from this client.
   */
  verifier: defineTable({
    sessionId: v.optional(v.id("session")),
    signature: v.optional(v.string()),
  }).index("signature", ["signature"]),

  /**
   * Rate limit tracking for OTP and password sign-in attempts.
   */
  limit: defineTable({
    identifier: v.string(),
    lastAttemptTime: v.number(),
    attemptsLeft: v.number(),
  }).index("identifier", ["identifier"]),

  /**
   * Hierarchical groups. A group with no `parentGroupId` is a root group.
   * Groups can nest arbitrarily deep via `parentGroupId` for modeling
   * organizations, teams, departments, or any tree structure.
   */
  group: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    parentGroupId: v.optional(v.id("group")),
    metadata: v.optional(v.any()),
  })
    .index("slug", ["slug"])
    .index("parentGroupId", ["parentGroupId"]),

  /**
   * Group membership. Links a user to a group with an application-defined
   * role (e.g. "owner", "admin", "member", "viewer"). A user can be a
   * member of multiple groups with different roles in each.
   */
  member: defineTable({
    groupId: v.id("group"),
    userId: v.id("user"),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("groupId", ["groupId"])
    .index("groupIdAndUserId", ["groupId", "userId"])
    .index("userId", ["userId"]),

  /**
   * Group invitations. Tracks pending, accepted, revoked, and expired
   * invitations to join a group. Uses a hashed token for secure
   * invitation links.
   */
  invite: defineTable({
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
    acceptedByUserId: v.optional(v.id("user")),
    acceptedTime: v.optional(v.number()),
    metadata: v.optional(v.any()),
  })
    .index("tokenHash", ["tokenHash"])
    .index("emailAndStatus", ["email", "status"])
    .index("invitedByUserIdAndStatus", ["invitedByUserId", "status"])
    .index("groupId", ["groupId"])
    .index("groupIdAndStatus", ["groupId", "status"]),
});
