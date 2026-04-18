import type { ComponentCtx as ComponentWriteCtx, ComponentReadCtx } from "./componentContext";
import { cached, invalidateCtxCache } from "./ctxCache";
import type { ConvexAuthMaterializedConfig } from "./types";

type ComponentPublic = ConvexAuthMaterializedConfig["component"]["public"];
type UntypedRunQuery = <TArgs extends Record<string, unknown>, TResult>(
  ref: unknown,
  args: TArgs,
) => Promise<TResult>;
type UntypedRunMutation = <TArgs extends Record<string, unknown>, TResult>(
  ref: unknown,
  args: TArgs,
) => Promise<TResult>;

export type GroupConnectionRecord = {
  _id: string;
  _creationTime: number;
  groupId: string;
  slug?: string;
  name?: string;
  protocol: "oidc" | "saml";
  status: "draft" | "active" | "disabled";
  config?: unknown;
  extend?: unknown;
};

export type GroupConnectionDomainLookupRecord = {
  connection: GroupConnectionRecord | null;
  domain: ConnectionDomainRecord | null;
};

export type GroupConnectionListResult = {
  items: GroupConnectionRecord[];
  nextCursor: string | null;
};

export type GroupRecord = {
  _id: string;
  _creationTime: number;
  name: string;
  slug?: string;
  type?: string;
  parentGroupId?: string;
  rootGroupId?: string;
  isRoot?: boolean;
  policy?: unknown;
  extend?: unknown;
};

export type ConnectionDomainRecord = {
  _id: string;
  _creationTime: number;
  connectionId: string;
  groupId: string;
  domain: string;
  isPrimary: boolean;
  verifiedAt?: number;
};

export type ConnectionDomainVerificationRecord = {
  domainId: string;
  recordName: string;
  token: string;
  expiresAt: number;
};

export type ScimConfigRecord = {
  _id: string;
  _creationTime: number;
  connectionId: string;
  groupId: string;
  status: string;
  basePath: string;
  tokenHash: string;
  lastRotatedAt?: number;
  extend?: unknown;
};

export type GroupConnectionSecretRecord = {
  ciphertext: string;
};

export type WebhookEndpointRecord = {
  _id: string;
  _creationTime: number;
  connectionId: string;
  groupId: string;
  url: string;
  status: string;
  secretHash: string;
  subscriptions: string[];
  createdByUserId?: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  failureCount: number;
  extend?: unknown;
};

export type WebhookDeliveryRecord = {
  _id: string;
  _creationTime: number;
  connectionId: string;
  endpointId: string;
  auditEventId?: string;
  eventType: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: number;
  lastAttemptAt?: number;
  lastResponseStatus?: number;
  lastError?: string;
  payload: unknown;
};

export type ScimIdentityRecord = {
  _id: string;
  _creationTime: number;
  connectionId: string;
  groupId: string;
  resourceType: string;
  externalId: string;
  userId?: string;
  mappedGroupId?: string;
  active?: boolean;
  raw?: Record<string, unknown>;
  lastProvisionedAt?: number;
};

export type AuditEventRecord = {
  _id: string;
  _creationTime: number;
  connectionId?: string;
  groupId: string;
  eventType: string;
  actorType: string;
  actorId?: string;
  subjectType: string;
  subjectId?: string;
  status: string;
  occurredAt: number;
  requestId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
};

const query = <TArgs extends Record<string, unknown>, TResult>(
  ctx: ComponentReadCtx,
  ref: unknown,
  args: TArgs,
) => (ctx.runQuery as UntypedRunQuery)(ref, args) as Promise<TResult>;

const mutate = <TArgs extends Record<string, unknown>, TResult>(
  ctx: ComponentWriteCtx,
  ref: unknown,
  args: TArgs,
) => (ctx.runMutation as UntypedRunMutation)(ref, args) as Promise<TResult>;

export const getGroupConnection = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  connectionId: string,
) =>
  cached(ctx, `group-connection:${connectionId}`, () =>
    query<{ connectionId: string }, GroupConnectionRecord | null>(
      ctx,
      componentPublic.groupConnectionGet,
      { connectionId },
    ),
  );

export const getGroupConnectionByDomain = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  domain: string,
) =>
  cached(ctx, `group-connection-domain:${domain}`, () =>
    query<{ domain: string }, GroupConnectionDomainLookupRecord | null>(
      ctx,
      componentPublic.groupConnectionGetByDomain,
      { domain },
    ),
  );

export const listGroupConnections = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: {
    where?: {
      groupId?: string;
      slug?: string;
      status?: "draft" | "active" | "disabled";
    };
    limit?: number;
    cursor?: string | null;
    orderBy?: "_creationTime" | "name" | "slug" | "status";
    order?: "asc" | "desc";
  },
) => query<typeof args, GroupConnectionListResult>(ctx, componentPublic.groupConnectionList, args);

export const createGroupConnection = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    groupId: string;
    protocol: "oidc" | "saml";
    slug?: string;
    name?: string;
    status?: "draft" | "active" | "disabled";
    config?: Record<string, unknown>;
    extend?: Record<string, unknown>;
  },
) => mutate<typeof args, string>(ctx, componentPublic.groupConnectionCreate, args);

export const updateGroupConnection = async (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: { connectionId: string; data: Record<string, unknown> },
) => {
  const result = await mutate<typeof args, null>(ctx, componentPublic.groupConnectionUpdate, args);
  invalidateCtxCache(ctx, `group-connection:${args.connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const deleteGroupConnection = async (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  connectionId: string,
) => {
  const result = await mutate<{ connectionId: string }, null>(
    ctx,
    componentPublic.groupConnectionDelete,
    { connectionId },
  );
  invalidateCtxCache(ctx, `group-connection:${connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  invalidateCtxCache(ctx, `connection-domains:${connectionId}`);
  invalidateCtxCache(ctx, "group-connection-secret");
  return result;
};

export const getGroup = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  groupId: string,
) =>
  cached(ctx, `group-record:${groupId}`, () =>
    query<{ groupId: string }, GroupRecord | null>(ctx, componentPublic.groupGet, { groupId }),
  );

export const listConnectionDomains = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  connectionId: string,
) =>
  cached(ctx, `connection-domains:${connectionId}`, () =>
    query<{ connectionId: string }, ConnectionDomainRecord[]>(
      ctx,
      componentPublic.groupConnectionDomainList,
      { connectionId },
    ),
  );

export const addConnectionDomain = async (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    groupId: string;
    domain: string;
    isPrimary?: boolean;
  },
) => {
  const result = await mutate<typeof args, string>(
    ctx,
    componentPublic.groupConnectionDomainAdd,
    args,
  );
  invalidateCtxCache(ctx, `connection-domains:${args.connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const deleteConnectionDomain = async (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  domainId: string,
) => {
  const result = await mutate<{ domainId: string }, null>(
    ctx,
    componentPublic.groupConnectionDomainDelete,
    { domainId },
  );
  invalidateCtxCache(ctx, "connection-domains");
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const getScimConfigByConnection = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  connectionId: string,
) =>
  cached(ctx, `scim-config-by-connection:${connectionId}`, () =>
    query<{ connectionId: string }, ScimConfigRecord | null>(
      ctx,
      componentPublic.groupConnectionScimConfigGetByGroupConnection,
      { connectionId },
    ),
  );

export const getScimConfigByTokenHash = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  tokenHash: string,
) =>
  query<{ tokenHash: string }, ScimConfigRecord | null>(
    ctx,
    componentPublic.groupConnectionScimConfigGetByTokenHash,
    { tokenHash },
  );

export const upsertScimConfig = async (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    groupId: string;
    status: string;
    basePath: string;
    tokenHash: string;
    lastRotatedAt: number;
    extend?: unknown;
  },
) => {
  const result = await mutate<typeof args, string>(
    ctx,
    componentPublic.groupConnectionScimConfigUpsert,
    args,
  );
  invalidateCtxCache(ctx, `scim-config-by-connection:${args.connectionId}`);
  return result;
};

export const getConnectionDomainVerification = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  domainId: string,
) =>
  query<{ domainId: string }, ConnectionDomainVerificationRecord | null>(
    ctx,
    componentPublic.groupConnectionDomainVerificationGet,
    { domainId },
  );

export const upsertConnectionDomainVerification = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    groupId: string;
    domainId: string;
    domain: string;
    recordName: string;
    token: string;
    tokenHash: string;
    requestedAt: number;
    expiresAt: number;
  },
) => mutate<typeof args, null>(ctx, componentPublic.groupConnectionDomainVerificationUpsert, args);

export const deleteConnectionDomainVerification = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  domainId: string,
) =>
  mutate<{ domainId: string }, null>(ctx, componentPublic.groupConnectionDomainVerificationDelete, {
    domainId,
  });

export const verifyConnectionDomain = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: { domainId: string; verifiedAt: number },
) => mutate<typeof args, null>(ctx, componentPublic.groupConnectionDomainVerify, args);

export const getGroupConnectionSecret = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: { connectionId: string; kind: string },
) =>
  cached(ctx, `group-connection-secret:${args.connectionId}:${args.kind}`, () =>
    query<typeof args, GroupConnectionSecretRecord | null>(
      ctx,
      componentPublic.groupConnectionSecretGet,
      args,
    ),
  );

export const upsertGroupConnectionSecret = async (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    groupId: string;
    kind: string;
    ciphertext: string;
    updatedAt: number;
  },
) => {
  const result = await mutate<typeof args, null>(
    ctx,
    componentPublic.groupConnectionSecretUpsert,
    args,
  );
  invalidateCtxCache(ctx, `group-connection-secret:${args.connectionId}:${args.kind}`);
  return result;
};

export const listWebhookEndpoints = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  connectionId: string,
) =>
  query<{ connectionId: string }, WebhookEndpointRecord[]>(
    ctx,
    componentPublic.groupWebhookEndpointList,
    { connectionId },
  );

export const listWebhookDeliveries = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: { connectionId: string; limit?: number },
) =>
  query<typeof args, WebhookDeliveryRecord[]>(
    ctx,
    (componentPublic as Record<string, unknown>)["groupWebhookDeliveryList"],
    args,
  );

export const listScimIdentitiesByConnection = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  connectionId: string,
) =>
  query<{ connectionId: string }, ScimIdentityRecord[]>(
    ctx,
    componentPublic.groupConnectionScimIdentityListByGroupConnection,
    { connectionId },
  );

export const getScimIdentityByConnectionAndUser = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: { connectionId: string; userId: string },
) =>
  query<typeof args, ScimIdentityRecord | null>(
    ctx,
    componentPublic.groupConnectionScimIdentityGetByGroupConnectionAndUser,
    args,
  );

/**
 * Batched variant of {@link getScimIdentityByConnectionAndUser}. Resolves
 * SCIM identities for many users under the same connection in a single
 * component round-trip — avoids the per-user fan-out on large SCIM syncs.
 *
 * @internal
 */
export const getScimIdentityByConnectionAndUsers = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: { connectionId: string; userIds: string[] },
) =>
  query<typeof args, Array<{ userId: string; identity: ScimIdentityRecord | null }>>(
    ctx,
    (componentPublic as Record<string, unknown>)[
      "groupConnectionScimIdentityGetByGroupConnectionAndUsers"
    ],
    args,
  );

export const getScimIdentityByMappedGroup = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  mappedGroupId: string,
) =>
  query<{ mappedGroupId: string }, ScimIdentityRecord | null>(
    ctx,
    componentPublic.groupConnectionScimIdentityGetByMappedGroup,
    { mappedGroupId },
  );

export const upsertScimIdentity = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    groupId: string;
    resourceType: string;
    externalId: string;
    userId?: string;
    mappedGroupId?: string;
    active?: boolean;
    raw?: Record<string, unknown>;
    lastProvisionedAt?: number;
  },
) => mutate<typeof args, string>(ctx, componentPublic.groupConnectionScimIdentityUpsert, args);

export const deleteScimIdentity = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  identityId: string,
) =>
  mutate<{ identityId: string }, null>(ctx, componentPublic.groupConnectionScimIdentityDelete, {
    identityId,
  });

export const insertAccount = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    userId: string;
    provider: string;
    providerAccountId: string;
  },
) => mutate<typeof args, string>(ctx, componentPublic.accountInsert, args);

export const insertUser = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  data: Record<string, unknown>,
) => mutate<{ data: Record<string, unknown> }, string>(ctx, componentPublic.userInsert, { data });

export const patchUser = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: { userId: string; data: Record<string, unknown> },
) => mutate<typeof args, null>(ctx, componentPublic.userPatch, args);

export const getScimIdentity = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    resourceType: "user" | "group";
    externalId: string;
  },
) =>
  query<typeof args, ScimIdentityRecord | null>(
    ctx,
    componentPublic.groupConnectionScimIdentityGet,
    args,
  );

export const listAuditEvents = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: { connectionId?: string; groupId?: string; limit?: number },
) => query<typeof args, AuditEventRecord[]>(ctx, componentPublic.groupAuditEventList, args);

export const getWebhookEndpoint = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  endpointId: string,
) =>
  query<{ endpointId: string }, WebhookEndpointRecord | null>(
    ctx,
    componentPublic.groupWebhookEndpointGet,
    { endpointId },
  );

export const createWebhookEndpoint = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: {
    connectionId: string;
    groupId: string;
    url: string;
    secretHash: string;
    subscriptions: string[];
    createdByUserId?: string;
  },
) => mutate<typeof args, string>(ctx, componentPublic.groupWebhookEndpointCreate, args);

export const updateWebhookEndpoint = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: { endpointId: string; data: Record<string, unknown> },
) => mutate<typeof args, null>(ctx, componentPublic.groupWebhookEndpointUpdate, args);

export const listReadyWebhookDeliveries = (
  ctx: ComponentReadCtx,
  componentPublic: ComponentPublic,
  args: { now: number; limit?: number },
) =>
  query<typeof args, WebhookDeliveryRecord[]>(
    ctx,
    componentPublic.groupWebhookDeliveryListReady,
    args,
  );

export const patchWebhookDelivery = (
  ctx: ComponentWriteCtx,
  componentPublic: ComponentPublic,
  args: { deliveryId: string; data: Record<string, unknown> },
) => mutate<typeof args, null>(ctx, componentPublic.groupWebhookDeliveryPatch, args);
