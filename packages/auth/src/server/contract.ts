import type { ComponentCtx as ComponentWriteCtx, ComponentReadCtx } from "./component/context";
import { cached, invalidateCtxCache } from "./cache/context";
import type { ConvexAuthMaterializedConfig } from "./types";

type ComponentSso = ConvexAuthMaterializedConfig["component"]["sso"];
type ComponentUser = ConvexAuthMaterializedConfig["component"]["user"];
type UntypedRunQuery = <TArgs extends Record<string, unknown>, TResult>(
  ref: unknown,
  args: TArgs,
) => Promise<TResult>;
type UntypedRunMutation = <TArgs extends Record<string, unknown>, TResult>(
  ref: unknown,
  args: TArgs,
) => Promise<TResult>;

type GroupConnectionRecord = {
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

type GroupConnectionDomainLookupRecord = {
  connection: GroupConnectionRecord | null;
  domain: ConnectionDomainRecord | null;
};

type GroupConnectionListResult = {
  items: GroupConnectionRecord[];
  nextCursor: string | null;
};

type GroupRecord = {
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

type ConnectionDomainRecord = {
  _id: string;
  _creationTime: number;
  connectionId: string;
  groupId: string;
  domain: string;
  isPrimary: boolean;
  verifiedAt?: number;
};

type ConnectionDomainVerificationRecord = {
  domainId: string;
  recordName: string;
  token: string;
  expiresAt: number;
};

type ScimConfigRecord = {
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

type GroupConnectionSecretRecord = {
  ciphertext: string;
};

type WebhookEndpointRecord = {
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

type WebhookDeliveryRecord = {
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

type AuditEventRecord = {
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
  componentSso: ComponentSso,
  connectionId: string,
) =>
  cached(ctx, `group-connection:${connectionId}`, () =>
    query<{ connectionId: string }, GroupConnectionRecord | null>(
      ctx,
      componentSso.connection.get,
      { connectionId },
    ),
  );

export const getGroupConnectionByDomain = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  domain: string,
) =>
  cached(ctx, `group-connection-domain:${domain}`, () =>
    query<{ domain: string }, GroupConnectionDomainLookupRecord | null>(
      ctx,
      componentSso.connection.get,
      { domain },
    ),
  );

export const listGroupConnections = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
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
) => query<typeof args, GroupConnectionListResult>(ctx, componentSso.connection.list, args);

export const createGroupConnection = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: {
    groupId: string;
    protocol: "oidc" | "saml";
    slug?: string;
    name?: string;
    status?: "draft" | "active" | "disabled";
    config?: Record<string, unknown>;
    extend?: Record<string, unknown>;
  },
) => mutate<typeof args, string>(ctx, componentSso.connection.create, args);

export const updateGroupConnection = async (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: { connectionId: string; data: Record<string, unknown> },
) => {
  const result = await mutate<typeof args, null>(ctx, componentSso.connection.update, args);
  invalidateCtxCache(ctx, `group-connection:${args.connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const deleteGroupConnection = async (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  connectionId: string,
) => {
  const result = await mutate<{ connectionId: string }, null>(
    ctx,
    componentSso.connection.delete,
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
  componentGroup: ConvexAuthMaterializedConfig["component"]["group"],
  groupId: string,
) =>
  cached(ctx, `group-record:${groupId}`, () =>
    query<{ id: string }, GroupRecord | null>(ctx, componentGroup.get, { id: groupId }),
  );

export const listConnectionDomains = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  connectionId: string,
) =>
  cached(ctx, `connection-domains:${connectionId}`, () =>
    query<{ connectionId: string }, ConnectionDomainRecord[]>(
      ctx,
      componentSso.connection.domain.list,
      { connectionId },
    ),
  );

export const addConnectionDomain = async (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: {
    connectionId: string;
    groupId: string;
    domain: string;
    isPrimary?: boolean;
  },
) => {
  const result = await mutate<typeof args, string>(
    ctx,
    componentSso.connection.domain.create,
    args,
  );
  invalidateCtxCache(ctx, `connection-domains:${args.connectionId}`);
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const deleteConnectionDomain = async (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  domainId: string,
) => {
  const result = await mutate<{ domainId: string }, null>(
    ctx,
    componentSso.connection.domain.delete,
    { domainId },
  );
  invalidateCtxCache(ctx, "connection-domains");
  invalidateCtxCache(ctx, "group-connection-domain");
  return result;
};

export const getScimConfigByConnection = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  connectionId: string,
) =>
  cached(ctx, `scim-config-by-connection:${connectionId}`, () =>
    query<{ connectionId: string }, ScimConfigRecord | null>(
      ctx,
      componentSso.connection.scimConfig.get,
      { connectionId },
    ),
  );

export const getScimConfigByTokenHash = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  tokenHash: string,
) =>
  query<{ tokenHash: string }, ScimConfigRecord | null>(
    ctx,
    componentSso.connection.scimConfig.get,
    { tokenHash },
  );

export const upsertScimConfig = async (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
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
    componentSso.connection.scimConfig.upsert,
    args,
  );
  invalidateCtxCache(ctx, `scim-config-by-connection:${args.connectionId}`);
  return result;
};

export const getConnectionDomainVerification = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  domainId: string,
) =>
  query<{ domainId: string }, ConnectionDomainVerificationRecord | null>(
    ctx,
    componentSso.connection.domain.verification.get,
    { domainId },
  );

export const upsertConnectionDomainVerification = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
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
) => mutate<typeof args, null>(ctx, componentSso.connection.domain.verification.upsert, args);

export const deleteConnectionDomainVerification = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  domainId: string,
) =>
  mutate<{ domainId: string }, null>(ctx, componentSso.connection.domain.verification.delete, {
    domainId,
  });

export const verifyConnectionDomain = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: { domainId: string; verifiedAt: number },
) => mutate<typeof args, null>(ctx, componentSso.connection.domain.verify, args);

export const getGroupConnectionSecret = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  args: { connectionId: string; kind: string },
) =>
  cached(ctx, `group-connection-secret:${args.connectionId}:${args.kind}`, () =>
    query<typeof args, GroupConnectionSecretRecord | null>(
      ctx,
      componentSso.connection.secret.get,
      args,
    ),
  );

export const upsertGroupConnectionSecret = async (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
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
    componentSso.connection.secret.upsert,
    args,
  );
  invalidateCtxCache(ctx, `group-connection-secret:${args.connectionId}:${args.kind}`);
  return result;
};

export const listWebhookEndpoints = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  connectionId: string,
) =>
  query<{ connectionId: string }, WebhookEndpointRecord[]>(
    ctx,
    componentSso.webhook.endpoint.list,
    { connectionId },
  );

export const listWebhookDeliveries = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  args: { connectionId: string; limit?: number },
) =>
  query<typeof args, WebhookDeliveryRecord[]>(
    ctx,
    componentSso.webhook.delivery.list,
    args,
  );

export const listScimIdentitiesByConnection = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  connectionId: string,
) =>
  query<{ connectionId: string }, ScimIdentityRecord[]>(
    ctx,
    componentSso.connection.scimIdentity.list,
    { connectionId },
  );

export const getScimIdentityByConnectionAndUser = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  args: { connectionId: string; userId: string },
) =>
  query<typeof args, ScimIdentityRecord | null>(
    ctx,
    componentSso.connection.scimIdentity.get,
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
  componentSso: ComponentSso,
  args: { connectionId: string; userIds: string[] },
) =>
  query<typeof args, Array<{ userId: string; identity: ScimIdentityRecord | null }>>(
    ctx,
    componentSso.connection.scimIdentity.getMany,
    args,
  );

export const getScimIdentityByMappedGroup = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  mappedGroupId: string,
) =>
  query<{ mappedGroupId: string }, ScimIdentityRecord | null>(
    ctx,
    componentSso.connection.scimIdentity.get,
    { mappedGroupId },
  );

export const upsertScimIdentity = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
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
) => mutate<typeof args, string>(ctx, componentSso.connection.scimIdentity.upsert, args);

export const deleteScimIdentity = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  identityId: string,
) =>
  mutate<{ identityId: string }, null>(ctx, componentSso.connection.scimIdentity.delete, {
    identityId,
  });

export const insertAccount = (
  ctx: ComponentWriteCtx,
  componentAccount: ConvexAuthMaterializedConfig["component"]["account"],
  args: {
    userId: string;
    provider: string;
    providerAccountId: string;
  },
) => mutate<typeof args, string>(ctx, componentAccount.create, args);

export const insertUser = (
  ctx: ComponentWriteCtx,
  componentUser: ComponentUser,
  data: Record<string, unknown>,
) => mutate<{ data: Record<string, unknown> }, string>(ctx, componentUser.create, { data });

export const patchUser = (
  ctx: ComponentWriteCtx,
  componentUser: ComponentUser,
  args: { userId: string; data: Record<string, unknown> },
) => mutate<typeof args, null>(ctx, componentUser.update, args);

export const getScimIdentity = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  args: {
    connectionId: string;
    resourceType: "user" | "group";
    externalId: string;
  },
) =>
  query<typeof args, ScimIdentityRecord | null>(
    ctx,
    componentSso.connection.scimIdentity.get,
    args,
  );

export const listAuditEvents = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  args: { connectionId?: string; groupId?: string; limit?: number },
) => query<typeof args, AuditEventRecord[]>(ctx, componentSso.audit.list, args);

export const getWebhookEndpoint = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  endpointId: string,
) =>
  query<{ endpointId: string }, WebhookEndpointRecord | null>(
    ctx,
    componentSso.webhook.endpoint.get,
    { endpointId },
  );

export const createWebhookEndpoint = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: {
    connectionId: string;
    groupId: string;
    url: string;
    secretHash: string;
    subscriptions: string[];
    createdByUserId?: string;
  },
) => mutate<typeof args, string>(ctx, componentSso.webhook.endpoint.create, args);

export const updateWebhookEndpoint = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: { endpointId: string; data: Record<string, unknown> },
) => mutate<typeof args, null>(ctx, componentSso.webhook.endpoint.update, args);

export const listReadyWebhookDeliveries = (
  ctx: ComponentReadCtx,
  componentSso: ComponentSso,
  args: { now: number; limit?: number },
) =>
  query<typeof args, WebhookDeliveryRecord[]>(
    ctx,
    componentSso.webhook.delivery.list,
    args,
  );

export const patchWebhookDelivery = (
  ctx: ComponentWriteCtx,
  componentSso: ComponentSso,
  args: { deliveryId: string; data: Record<string, unknown> },
) => mutate<typeof args, null>(ctx, componentSso.webhook.delivery.update, args);
