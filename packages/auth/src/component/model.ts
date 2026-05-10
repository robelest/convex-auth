import { v } from "convex/values";

export const TABLES = {
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
  GroupConnection: "GroupConnection",
  GroupConnectionDomain: "GroupConnectionDomain",
  GroupConnectionDomainVerification: "GroupConnectionDomainVerification",
  GroupConnectionSecret: "GroupConnectionSecret",
  GroupConnectionScimConfig: "GroupConnectionScimConfig",
  GroupConnectionScimIdentity: "GroupConnectionScimIdentity",
  GroupAuditEvent: "GroupAuditEvent",
  GroupWebhookEndpoint: "GroupWebhookEndpoint",
  GroupWebhookDelivery: "GroupWebhookDelivery",
  ApiKey: "ApiKey",
  DeviceCode: "DeviceCode",
} as const;

export const vTag = v.object({ key: v.string(), value: v.string() });

export const vPaginated = (item: any) =>
  v.object({
    items: v.array(item),
    nextCursor: v.union(v.string(), v.null()),
  });

export const vInviteStatus = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("revoked"),
  v.literal("expired"),
);

export const vDeviceStatus = v.union(
  v.literal("pending"),
  v.literal("authorized"),
  v.literal("denied"),
);

export const vGroupConnectionAccountLinkingPolicy = v.union(
  v.literal("verifiedEmail"),
  v.literal("none"),
);

export const vGroupConnectionScimReuseUserPolicy = v.union(
  v.literal("externalId"),
  v.literal("none"),
);

export const vGroupConnectionJitProvisioningMode = v.union(
  v.literal("off"),
  v.literal("createUser"),
  v.literal("createUserAndMembership"),
);

export const vGroupConnectionDeprovisionMode = v.union(v.literal("soft"), v.literal("hard"));

export const vGroupConnectionProfileUpdateMode = v.union(
  v.literal("never"),
  v.literal("missing"),
  v.literal("always"),
);

export const vGroupConnectionProvisioningAuthority = v.union(
  v.literal("app"),
  v.literal("sso"),
  v.literal("scim"),
);

export const vGroupConnectionGroupSyncMode = v.union(v.literal("ignore"), v.literal("sync"));

export const vGroupConnectionRoleSyncMode = v.union(v.literal("ignore"), v.literal("map"));

export const vGroupConnectionStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("disabled"),
);

export const vGroupConnectionProtocol = v.union(v.literal("oidc"), v.literal("saml"));

export const vGroupConnectionPolicy = v.object({
  version: v.literal(1),
  identity: v.object({
    accountLinking: v.object({
      oidc: vGroupConnectionAccountLinkingPolicy,
      saml: vGroupConnectionAccountLinkingPolicy,
    }),
  }),
  provisioning: v.object({
    user: v.object({
      createOnSignIn: v.boolean(),
      updateProfileOnLogin: vGroupConnectionProfileUpdateMode,
      updateProfileFromScim: vGroupConnectionProfileUpdateMode,
      authority: vGroupConnectionProvisioningAuthority,
    }),
    scimReuse: v.object({
      user: vGroupConnectionScimReuseUserPolicy,
    }),
    jit: v.object({
      mode: vGroupConnectionJitProvisioningMode,
      defaultRole: v.optional(v.string()),
      defaultRoleIds: v.optional(v.array(v.string())),
    }),
    deprovision: v.object({
      mode: vGroupConnectionDeprovisionMode,
    }),
    groups: v.object({
      mode: vGroupConnectionGroupSyncMode,
      source: v.literal("protocol"),
      mapping: v.optional(v.record(v.string(), v.array(v.string()))),
    }),
    roles: v.object({
      mode: vGroupConnectionRoleSyncMode,
      source: v.literal("protocol"),
      mapping: v.optional(v.record(v.string(), v.array(v.string()))),
    }),
  }),
  extend: v.optional(v.any()),
});

export const vScimStatus = v.union(v.literal("draft"), v.literal("active"), v.literal("disabled"));

export const vScimResourceType = v.union(v.literal("user"), v.literal("group"));

export const vAuditActorType = v.union(
  v.literal("user"),
  v.literal("system"),
  v.literal("scim"),
  v.literal("api_key"),
  v.literal("webhook"),
);

export const vAuditStatus = v.union(v.literal("success"), v.literal("failure"));

export const vWebhookEndpointStatus = v.union(v.literal("active"), v.literal("disabled"));

export const vWebhookDeliveryStatus = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("delivered"),
  v.literal("failed"),
);

export const vInviteTokenAcceptStatus = v.union(
  v.literal("accepted"),
  v.literal("already_accepted"),
);

export const vMembershipStatus = v.union(
  v.literal("joined"),
  v.literal("already_joined"),
  v.literal("not_applicable"),
);

export const vApiKeyScope = v.object({
  resource: v.string(),
  actions: v.array(v.string()),
});

export const vApiKeyRateLimit = v.object({
  maxRequests: v.number(),
  windowMs: v.number(),
});

export const vApiKeyRateLimitState = v.object({
  attemptsLeft: v.number(),
  lastAttemptTime: v.number(),
});

export const vGroupConnectionSecretKind = v.union(v.literal("oidc_client_secret"));

function vDocMeta<T extends (typeof TABLES)[keyof typeof TABLES]>(tableName: T) {
  return {
    _id: v.id(tableName),
    _creationTime: v.number(),
  };
}

export const vUserDoc = v.object({
  ...vDocMeta(TABLES.User),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  hasTotp: v.optional(v.boolean()),
  extend: v.optional(v.any()),
});

export const vSessionDoc = v.object({
  ...vDocMeta(TABLES.Session),
  userId: v.id(TABLES.User),
  expirationTime: v.number(),
});

export const vAccountDoc = v.object({
  ...vDocMeta(TABLES.Account),
  userId: v.id(TABLES.User),
  provider: v.string(),
  providerAccountId: v.string(),
  secret: v.optional(v.string()),
  emailVerified: v.optional(v.string()),
  phoneVerified: v.optional(v.string()),
  extend: v.optional(v.any()),
});

export const vAuthVerifierDoc = v.object({
  ...vDocMeta(TABLES.AuthVerifier),
  sessionId: v.optional(v.id(TABLES.Session)),
  signature: v.optional(v.string()),
  expirationTime: v.optional(v.number()),
});

export const vVerificationCodeDoc = v.object({
  ...vDocMeta(TABLES.VerificationCode),
  accountId: v.id(TABLES.Account),
  provider: v.string(),
  code: v.string(),
  expirationTime: v.number(),
  verifier: v.optional(v.string()),
  emailVerified: v.optional(v.string()),
  phoneVerified: v.optional(v.string()),
});

export const vRefreshTokenDoc = v.object({
  ...vDocMeta(TABLES.RefreshToken),
  sessionId: v.id(TABLES.Session),
  expirationTime: v.number(),
  firstUsedTime: v.optional(v.number()),
  parentRefreshTokenId: v.optional(v.id(TABLES.RefreshToken)),
});

export const vPasskeyDoc = v.object({
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

export const vTotpFactorDoc = v.object({
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

export const vRateLimitDoc = v.object({
  ...vDocMeta(TABLES.RateLimit),
  identifier: v.string(),
  last_attempt_time: v.number(),
  attempts_left: v.number(),
});

export const vGroupDoc = v.object({
  ...vDocMeta(TABLES.Group),
  name: v.string(),
  slug: v.optional(v.string()),
  type: v.optional(v.string()),
  parentGroupId: v.optional(v.id(TABLES.Group)),
  rootGroupId: v.optional(v.id(TABLES.Group)),
  isRoot: v.optional(v.boolean()),
  tags: v.optional(v.array(vTag)),
  policy: v.optional(vGroupConnectionPolicy),
  extend: v.optional(v.any()),
});

export const vGroupMemberDoc = v.object({
  ...vDocMeta(TABLES.GroupMember),
  groupId: v.id(TABLES.Group),
  userId: v.id(TABLES.User),
  role: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
  status: v.optional(v.string()),
  extend: v.optional(v.any()),
});

export const vGroupInviteDoc = v.object({
  ...vDocMeta(TABLES.GroupInvite),
  groupId: v.optional(v.id(TABLES.Group)),
  invitedByUserId: v.optional(v.id(TABLES.User)),
  email: v.optional(v.string()),
  tokenHash: v.string(),
  role: v.optional(v.string()),
  roleIds: v.optional(v.array(v.string())),
  status: vInviteStatus,
  expiresTime: v.optional(v.number()),
  acceptedByUserId: v.optional(v.id(TABLES.User)),
  acceptedTime: v.optional(v.number()),
  extend: v.optional(v.any()),
});

export const vApiKeyDoc = v.object({
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
  metadata: v.optional(v.any()),
});

export const vDeviceCodeDoc = v.object({
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

export const vGroupConnectionDoc = v.object({
  ...vDocMeta(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  slug: v.optional(v.string()),
  name: v.optional(v.string()),
  protocol: vGroupConnectionProtocol,
  status: vGroupConnectionStatus,
  config: v.optional(v.any()),
  extend: v.optional(v.any()),
});

export const vGroupConnectionDomainDoc = v.object({
  ...vDocMeta(TABLES.GroupConnectionDomain),
  connectionId: v.id(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  domain: v.string(),
  isPrimary: v.boolean(),
  verifiedAt: v.optional(v.number()),
});

export const vGroupConnectionDomainVerificationDoc = v.object({
  ...vDocMeta(TABLES.GroupConnectionDomainVerification),
  connectionId: v.id(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  domainId: v.id(TABLES.GroupConnectionDomain),
  domain: v.string(),
  recordName: v.string(),
  token: v.string(),
  tokenHash: v.string(),
  requestedAt: v.number(),
  expiresAt: v.number(),
});

export const vGroupConnectionSecretDoc = v.object({
  ...vDocMeta(TABLES.GroupConnectionSecret),
  connectionId: v.id(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  kind: vGroupConnectionSecretKind,
  ciphertext: v.string(),
  updatedAt: v.number(),
});

export const vGroupConnectionScimConfigDoc = v.object({
  ...vDocMeta(TABLES.GroupConnectionScimConfig),
  connectionId: v.id(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  status: vScimStatus,
  basePath: v.string(),
  tokenHash: v.string(),
  lastRotatedAt: v.optional(v.number()),
  extend: v.optional(v.any()),
});

export const vGroupConnectionScimIdentityDoc = v.object({
  ...vDocMeta(TABLES.GroupConnectionScimIdentity),
  connectionId: v.id(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  resourceType: vScimResourceType,
  externalId: v.string(),
  userId: v.optional(v.id(TABLES.User)),
  mappedGroupId: v.optional(v.id(TABLES.Group)),
  lastProvisionedAt: v.optional(v.number()),
  active: v.optional(v.boolean()),
  raw: v.optional(v.any()),
});

export const vGroupAuditEventDoc = v.object({
  ...vDocMeta(TABLES.GroupAuditEvent),
  connectionId: v.optional(v.id(TABLES.GroupConnection)),
  groupId: v.id(TABLES.Group),
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
});

export const vGroupWebhookEndpointDoc = v.object({
  ...vDocMeta(TABLES.GroupWebhookEndpoint),
  connectionId: v.id(TABLES.GroupConnection),
  groupId: v.id(TABLES.Group),
  url: v.string(),
  status: vWebhookEndpointStatus,
  secretHash: v.string(),
  subscriptions: v.array(v.string()),
  createdByUserId: v.optional(v.id(TABLES.User)),
  lastSuccessAt: v.optional(v.number()),
  lastFailureAt: v.optional(v.number()),
  failureCount: v.number(),
  extend: v.optional(v.any()),
});

export const vGroupWebhookDeliveryDoc = v.object({
  ...vDocMeta(TABLES.GroupWebhookDelivery),
  connectionId: v.id(TABLES.GroupConnection),
  endpointId: v.id(TABLES.GroupWebhookEndpoint),
  auditEventId: v.optional(v.id(TABLES.GroupAuditEvent)),
  eventType: v.string(),
  status: vWebhookDeliveryStatus,
  attemptCount: v.number(),
  nextAttemptAt: v.number(),
  lastAttemptAt: v.optional(v.number()),
  lastResponseStatus: v.optional(v.number()),
  lastError: v.optional(v.string()),
  payload: v.any(),
});

export const vRateLimitResult = v.object({
  ...vDocMeta(TABLES.RateLimit),
  identifier: v.string(),
  last_attempt_time: v.number(),
  attempts_left: v.number(),
  attemptsLeft: v.number(),
  lastAttemptTime: v.number(),
});

export const vInviteAcceptByTokenResult = v.object({
  inviteId: v.id(TABLES.GroupInvite),
  groupId: v.union(v.id(TABLES.Group), v.null()),
  memberId: v.optional(v.id(TABLES.GroupMember)),
  inviteStatus: vInviteTokenAcceptStatus,
  membershipStatus: vMembershipStatus,
});
