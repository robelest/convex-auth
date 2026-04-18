import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  vApiKeyRateLimit,
  vApiKeyRateLimitState,
  vApiKeyScope,
  vAuditActorType,
  vAuditStatus,
  vDeviceStatus,
  vGroupConnectionPolicy,
  vGroupConnectionProtocol,
  vGroupConnectionSecretKind,
  vGroupConnectionStatus,
  vInviteStatus,
  vScimResourceType,
  vScimStatus,
  vTag,
  vWebhookDeliveryStatus,
  vWebhookEndpointStatus,
} from "./model";

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
    hasTotp: v.optional(v.boolean()),
    extend: v.optional(v.any()),
  })
    .index("email", ["email"])
    .index("email_verified", ["email", "emailVerificationTime"])
    .index("phone", ["phone"])
    .index("phone_verified", ["phone", "phoneVerificationTime"]),

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
    extend: v.optional(v.any()),
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
    .index("session_id_first_used", ["sessionId", "firstUsedTime"])
    .index("session_id_parent_refresh_token_id", ["sessionId", "parentRefreshTokenId"]),

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
  })
    .index("user_id", ["userId"])
    .index("user_id_verified", ["userId", "verified"]),

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
    status: vDeviceStatus,
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
    /** Denormalized root group ID. Self-referencing for root groups. */
    rootGroupId: v.optional(v.id("Group")),
    /** Denormalized flag: `true` when `parentGroupId` is absent. */
    isRoot: v.optional(v.boolean()),
    /** Faceted classification tags. Normalized at write time (trimmed, lowercased). */
    tags: v.optional(v.array(vTag)),
    policy: v.optional(vGroupConnectionPolicy),
    extend: v.optional(v.any()),
  })
    .index("slug", ["slug"])
    .index("parent_group_id", ["parentGroupId"])
    .index("root_group_id", ["rootGroupId"])
    .index("is_root", ["isRoot"])
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
    roleIds: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    extend: v.optional(v.any()),
  })
    .index("group_id", ["groupId"])
    .index("group_id_user_id", ["groupId", "userId"])
    .index("group_id_status", ["groupId", "status"])
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
    roleIds: v.optional(v.array(v.string())),
    status: vInviteStatus,
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
    .index("group_id_status", ["groupId", "status"]),

  /**
   * Group Connection configuration attached to a root group/organization.
   *
   * The `config` payload intentionally stays flexible so the headless group connection
   * SDK can evolve without forcing schema churn for every protocol-specific
   * field addition.
   */
  GroupConnection: defineTable({
    groupId: v.id("Group"),
    slug: v.optional(v.string()),
    name: v.optional(v.string()),
    protocol: vGroupConnectionProtocol,
    status: vGroupConnectionStatus,
    config: v.optional(v.any()),
    extend: v.optional(v.any()),
  })
    .index("group_id", ["groupId"])
    .index("slug", ["slug"])
    .index("status", ["status"])
    .index("group_id_status", ["groupId", "status"])
    .index("group_id_slug", ["groupId", "slug"]),

  /**
   * Verified or pending domains linked to an group connection record.
   */
  GroupConnectionDomain: defineTable({
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    domain: v.string(),
    isPrimary: v.boolean(),
    verifiedAt: v.optional(v.number()),
  })
    .index("connection_id", ["connectionId"])
    .index("group_id", ["groupId"])
    .index("domain", ["domain"]),

  /**
   * Pending DNS TXT verification challenges for group connection domains.
   */
  GroupConnectionDomainVerification: defineTable({
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    domainId: v.id("GroupConnectionDomain"),
    domain: v.string(),
    recordName: v.string(),
    token: v.string(),
    tokenHash: v.string(),
    requestedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("connection_id", ["connectionId"])
    .index("domain_id", ["domainId"])
    .index("token_hash", ["tokenHash"]),

  /**
   * Encrypted group connection secrets stored separately from protocol config.
   */
  GroupConnectionSecret: defineTable({
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    kind: vGroupConnectionSecretKind,
    ciphertext: v.string(),
    updatedAt: v.number(),
  })
    .index("connection_id", ["connectionId"])
    .index("connection_id_kind", ["connectionId", "kind"])
    .index("group_id", ["groupId"]),

  /**
   * SCIM configuration for an group connection tenant.
   */
  GroupConnectionScimConfig: defineTable({
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    status: vScimStatus,
    basePath: v.string(),
    tokenHash: v.string(),
    lastRotatedAt: v.optional(v.number()),
    extend: v.optional(v.any()),
  })
    .index("group_connection_id", ["connectionId"])
    .index("group_id", ["groupId"])
    .index("token_hash", ["tokenHash"])
    .index("status", ["status"]),

  /**
   * External SCIM identities mapped into local users/groups.
   */
  GroupConnectionScimIdentity: defineTable({
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    resourceType: vScimResourceType,
    externalId: v.string(),
    userId: v.optional(v.id("User")),
    mappedGroupId: v.optional(v.id("Group")),
    lastProvisionedAt: v.optional(v.number()),
    active: v.optional(v.boolean()),
    raw: v.optional(v.any()),
  })
    .index("group_connection_id", ["connectionId"])
    .index("group_id", ["groupId"])
    .index("group_connection_id_resource_type_external_id", [
      "connectionId",
      "resourceType",
      "externalId",
    ])
    .index("group_connection_id_user_id", ["connectionId", "userId"])
    .index("user_id", ["userId"])
    .index("mapped_group_id", ["mappedGroupId"]),

  /**
   * Immutable audit trail for group connection operations.
   */
  GroupAuditEvent: defineTable({
    connectionId: v.optional(v.id("GroupConnection")),
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
  })
    .index("group_connection_id_occurred_at", ["connectionId", "occurredAt"])
    .index("group_id_occurred_at", ["groupId", "occurredAt"])
    .index("event_type_occurred_at", ["eventType", "occurredAt"]),

  /**
   * Webhook endpoints subscribed to group audit and lifecycle events.
   */
  GroupWebhookEndpoint: defineTable({
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    url: v.string(),
    status: vWebhookEndpointStatus,
    secretHash: v.string(),
    subscriptions: v.array(v.string()),
    createdByUserId: v.optional(v.id("User")),
    lastSuccessAt: v.optional(v.number()),
    lastFailureAt: v.optional(v.number()),
    failureCount: v.number(),
    extend: v.optional(v.any()),
  })
    .index("group_connection_id", ["connectionId"])
    .index("group_id", ["groupId"])
    .index("status", ["status"]),

  /**
   * Delivery queue for outbound group webhooks.
   */
  GroupWebhookDelivery: defineTable({
    connectionId: v.id("GroupConnection"),
    endpointId: v.id("GroupWebhookEndpoint"),
    auditEventId: v.optional(v.id("GroupAuditEvent")),
    eventType: v.string(),
    status: vWebhookDeliveryStatus,
    attemptCount: v.number(),
    nextAttemptAt: v.number(),
    lastAttemptAt: v.optional(v.number()),
    lastResponseStatus: v.optional(v.number()),
    lastError: v.optional(v.string()),
    payload: v.any(),
  })
    .index("group_connection_id", ["connectionId"])
    .index("status_next_attempt_at", ["status", "nextAttemptAt"])
    .index("endpoint_id_status", ["endpointId", "status"])
    .index("audit_event_id", ["auditEventId"]),

  /**
   * API keys for programmatic access. Each key links a user to a set of
   * scoped permissions and optional per-key rate limiting.
   *
   * The raw key is never stored — only a SHA-256 hash. A short prefix
   * (e.g. "sk_abc1...") is kept for display in admin interfaces.
   *
   * Keys support:
   * - **Scoped permissions**: resource:action pairs (e.g. users:read)
   * - **Per-key rate limiting**: token-bucket with configurable window
   * - **Expiration**: optional TTL
   * - **Soft revocation**: `revoked` flag preserves audit trail
   */
  ApiKey: defineTable({
    userId: v.id("User"),
    /** First chars of the key for display (e.g. "sk_abc1..."). */
    prefix: v.string(),
    /** SHA-256 hex hash of the full raw key. */
    hashedKey: v.string(),
    /** User-assigned name (e.g. "CI Pipeline", "Production API"). */
    name: v.string(),
    /** Scoped permissions: [{ resource: "users", actions: ["read", "list"] }]. */
    scopes: v.array(vApiKeyScope),
    /** Optional per-key rate limit configuration. */
    rateLimit: v.optional(vApiKeyRateLimit),
    /** Rate limit state tracking (token-bucket). */
    rateLimitState: v.optional(vApiKeyRateLimitState),
    /** Expiration timestamp. Null/undefined = never expires. */
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    /** Soft-revoke flag. Revoked keys are kept for audit trail. */
    revoked: v.boolean(),
    /** Arbitrary app-specific metadata attached to the key. */
    metadata: v.optional(v.any()),
  })
    .index("user_id", ["userId"])
    .index("hashed_key", ["hashedKey"]),
});
