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
  User: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    extend: v.optional(v.any()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  /**
   * Active sessions. A single user can have multiple concurrent sessions
   * across different devices or browsers. Sessions expire after a
   * configurable duration.
   */
  Session: defineTable({
    userId: v.id("User"),
    expirationTime: v.number(),
  }).index("user_id", ["userId"]),

  /**
   * Authentication accounts. Each account links a user to a single
   * authentication provider (e.g. Google OAuth, email/password).
   * A user can have multiple accounts linked.
   */
  Account: defineTable({
    userId: v.id("User"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index("user_id_provider", ["userId", "provider"])
    .index("provider_account_id", ["provider", "providerAccountId"]),

  /**
   * Refresh tokens for session continuity. Tokens are single-use and form
   * a chain — each token references the one it was exchanged from.
   *
   * The active refresh token is the most recently created token that has not
   * been used yet. A 10-second reuse window allows for concurrent requests.
   * Any invalid use of a token invalidates the entire chain.
   */
  RefreshToken: defineTable({
    sessionId: v.id("Session"),
    expirationTime: v.number(),
    firstUsedTime: v.optional(v.number()),
    parentRefreshTokenId: v.optional(v.id("RefreshToken")),
  })
    .index("session_id", ["sessionId"])
    .index("session_id_parent_refresh_token_id", [
      "sessionId",
      "parentRefreshTokenId",
    ]),

  /**
   * Verification codes for OTP tokens, magic link tokens, and OAuth codes.
   */
  VerificationCode: defineTable({
    accountId: v.id("Account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index("account_id", ["accountId"])
    .index("code", ["code"]),

  /**
   * PKCE verifiers for OAuth flows. Stores the cryptographic verifier
   * used to prove the authorization request originated from this client.
   */
  AuthVerifier: defineTable({
    sessionId: v.optional(v.id("Session")),
    signature: v.optional(v.string()),
  }).index("signature", ["signature"]),

  /**
   * WebAuthn passkey credentials. Each credential links a user to a
   * registered authenticator (Touch ID, Face ID, security key, etc.).
   * A user can have multiple passkeys across different devices.
   */
  Passkey: defineTable({
    userId: v.id("User"),
    /** Base64url-encoded credential ID from the authenticator. */
    credentialId: v.string(),
    /** Public key bytes (SEC1 uncompressed for EC, SPKI for RSA). */
    publicKey: v.bytes(),
    /** COSE algorithm identifier (-7 for ES256, -257 for RS256, -8 for EdDSA). */
    algorithm: v.number(),
    /** Signature counter for clone detection. Many authenticators return 0. */
    counter: v.number(),
    /** Authenticator transport hints (e.g. "internal", "hybrid", "usb", "ble", "nfc"). */
    transports: v.optional(v.array(v.string())),
    /** Whether this is a single-device or multi-device (synced) credential. */
    deviceType: v.string(),
    /** Whether the credential is backed up (synced passkey). */
    backedUp: v.boolean(),
    /** User-assigned friendly name (e.g. "MacBook Touch ID"). */
    name: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("user_id", ["userId"])
    .index("credential_id", ["credentialId"]),

  /**
   * TOTP two-factor authentication secrets. Each record links a user to
   * an authenticator app. A user can have multiple TOTP enrollments
   * (e.g. different authenticator apps) but typically has one.
   *
   * The `verified` flag indicates whether the user has completed setup
   * by successfully entering a code from their authenticator app.
   * Unverified enrollments are in-progress setup that can be discarded.
   */
  TotpFactor: defineTable({
    userId: v.id("User"),
    /** Raw TOTP secret key bytes. */
    secret: v.bytes(),
    /** Number of digits in each code (typically 6). */
    digits: v.number(),
    /** Time period in seconds for code rotation (typically 30). */
    period: v.number(),
    /** Whether setup has been confirmed with a valid code. */
    verified: v.boolean(),
    /** User-assigned friendly name (e.g. "Google Authenticator"). */
    name: v.optional(v.string()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  }).index("user_id", ["userId"]),

  /**
   * Device authorization codes (RFC 8628). Each record tracks a pending
   * device auth session — the device polls with `deviceCode` while the
   * user authorizes via `userCode` on a secondary device.
   */
  DeviceCode: defineTable({
    /** High-entropy code used by the device for polling. Stored as SHA-256 hash. */
    deviceCodeHash: v.string(),
    /** Short human-readable code the user enters (e.g. "WDJB-MJHT"). */
    userCode: v.string(),
    /** Expiration timestamp (ms since epoch). */
    expiresAt: v.number(),
    /** Minimum polling interval in seconds. */
    interval: v.number(),
    /** Current status of this device authorization session. */
    status: v.union(
      v.literal("pending"),
      v.literal("authorized"),
      v.literal("denied"),
    ),
    /** Set when the user authorizes — links to the authorizing user. */
    userId: v.optional(v.id("User")),
    /** Set when the user authorizes — the session created for the device. */
    sessionId: v.optional(v.id("Session")),
    /** Timestamp of the last poll request (for slow_down enforcement). */
    lastPolledAt: v.optional(v.number()),
  })
    .index("device_code_hash", ["deviceCodeHash"])
    .index("user_code_status", ["userCode", "status"]),

  /**
   * Rate limit tracking for OTP and password sign-in attempts.
   */
  RateLimit: defineTable({
    identifier: v.string(),
    last_attempt_time: v.number(),
    attempts_left: v.number(),
  }).index("by_identifier", ["identifier"]),

  /**
   * Hierarchical groups. A group with no `parentGroupId` is a root group.
   * Groups can nest arbitrarily deep via `parentGroupId` for modeling
   * organizations, teams, departments, or any tree structure.
   */
  Group: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    type: v.optional(v.string()),
    parentGroupId: v.optional(v.id("Group")),
    /** Faceted classification tags. Normalized at write time (trimmed, lowercased). */
    tags: v.optional(v.array(v.object({ key: v.string(), value: v.string() }))),
    extend: v.optional(v.any()),
  })
    .index("slug", ["slug"])
    .index("parent_group_id", ["parentGroupId"])
    .index("type", ["type"])
    .index("type_parent_group_id", ["type", "parentGroupId"]),

  /**
   * Denormalized group-tag index table for efficient tag-based filtering.
   * Each row maps one `(key, value)` pair to a group. Kept in sync by
   * `groupCreate`, `groupUpdate`, and `groupDelete`.
   */
  GroupTag: defineTable({
    group_id: v.id("Group"),
    key: v.string(),
    value: v.string(),
  })
    .index("by_group", ["group_id"])
    .index("by_key_value", ["key", "value"])
    .index("by_key", ["key"]),

  /**
   * Group membership. Links a user to a group with an application-defined
   * role (e.g. "owner", "admin", "member", "viewer"). A user can be a
   * member of multiple groups with different roles in each.
   */
  GroupMember: defineTable({
    groupId: v.id("Group"),
    userId: v.id("User"),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    extend: v.optional(v.any()),
  })
    .index("group_id", ["groupId"])
    .index("group_id_user_id", ["groupId", "userId"])
    .index("user_id", ["userId"]),

  /**
   * Invitations. Tracks pending, accepted, revoked, and expired
   * invitations. Optionally scoped to a group via `groupId`, or
   * platform-level when `groupId` is omitted.
   *
   * `email` and `invitedByUserId` are optional to support CLI-generated
   * invite links where neither is known upfront.
   */
  GroupInvite: defineTable({
    groupId: v.optional(v.id("Group")),
    invitedByUserId: v.optional(v.id("User")),
    email: v.optional(v.string()),
    tokenHash: v.string(),
    role: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresTime: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("User")),
    acceptedTime: v.optional(v.number()),
    extend: v.optional(v.any()),
  })
    .index("token_hash", ["tokenHash"])
    .index("status", ["status"])
    .index("email_status", ["email", "status"])
    .index("invited_by_user_id_status", ["invitedByUserId", "status"])
    .index("group_id", ["groupId"])
    .index("group_id_status", ["groupId", "status"])
    .index("role_status_accepted_by_user_id", [
      "role",
      "status",
      "acceptedByUserId",
    ]),

  /**
   * API keys for programmatic access. Each key links a user to a set of
   * scoped permissions and optional per-key rate limiting.
   *
   * The raw key is never stored — only a SHA-256 hash. A short prefix
   * (e.g. "sk_live_abc1...") is kept for display in admin interfaces.
   *
   * Keys support:
   * - **Scoped permissions**: resource:action pairs (e.g. users:read)
   * - **Per-key rate limiting**: token-bucket with configurable window
   * - **Expiration**: optional TTL
   * - **Soft revocation**: `revoked` flag preserves audit trail
   */
  ApiKey: defineTable({
    userId: v.id("User"),
    /** First chars of the key for display (e.g. "sk_live_abc1..."). */
    prefix: v.string(),
    /** SHA-256 hex hash of the full raw key. */
    hashedKey: v.string(),
    /** User-assigned name (e.g. "CI Pipeline", "Production API"). */
    name: v.string(),
    /** Scoped permissions: [{ resource: "users", actions: ["read", "list"] }]. */
    scopes: v.array(
      v.object({
        resource: v.string(),
        actions: v.array(v.string()),
      }),
    ),
    /** Optional per-key rate limit configuration. */
    rateLimit: v.optional(
      v.object({
        maxRequests: v.number(),
        windowMs: v.number(),
      }),
    ),
    /** Rate limit state tracking (token-bucket). */
    rateLimitState: v.optional(
      v.object({
        attemptsLeft: v.number(),
        lastAttemptTime: v.number(),
      }),
    ),
    /** Expiration timestamp. Null/undefined = never expires. */
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    /** Soft-revoke flag. Revoked keys are kept for audit trail. */
    revoked: v.boolean(),
  })
    .index("user_id", ["userId"])
    .index("hashed_key", ["hashedKey"]),
});
