import { ConvexError, v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../functions";
import {
  vAccountDoc,
  vApiKeyDoc,
  vApiKeyRateLimit,
  vApiKeyRateLimitState,
  vApiKeyScope,
  vAuditActorType,
  vAuditStatus,
  vAuthVerifierDoc,
  vDeviceCodeDoc,
  vDeviceStatus,
  vEnterpriseAuditEventDoc,
  vEnterpriseDoc,
  vEnterpriseDomainDoc,
  vEnterpriseDomainVerificationDoc,
  vEnterprisePolicy,
  vEnterpriseScimConfigDoc,
  vEnterpriseScimIdentityDoc,
  vEnterpriseSecretDoc,
  vEnterpriseSecretKind,
  vEnterpriseStatus,
  vEnterpriseWebhookDeliveryDoc,
  vEnterpriseWebhookEndpointDoc,
  vGroupDoc,
  vGroupInviteDoc,
  vGroupMemberDoc,
  vInviteAcceptByTokenResult,
  vInviteStatus,
  vPasskeyDoc,
  vRateLimitResult,
  vRefreshTokenDoc,
  vScimResourceType,
  vScimStatus,
  vSessionDoc,
  vTag,
  vTotpFactorDoc,
  vUserDoc,
  vVerificationCodeDoc,
  vWebhookEndpointStatus,
} from "../model";

export {
  ConvexError,
  mutation,
  query,
  v,
  vAccountDoc,
  vApiKeyDoc,
  vApiKeyRateLimit,
  vApiKeyRateLimitState,
  vApiKeyScope,
  vAuditActorType,
  vAuditStatus,
  vAuthVerifierDoc,
  vDeviceCodeDoc,
  vDeviceStatus,
  vEnterpriseAuditEventDoc,
  vEnterpriseDoc,
  vEnterpriseDomainDoc,
  vEnterpriseDomainVerificationDoc,
  vEnterprisePolicy,
  vEnterpriseScimConfigDoc,
  vEnterpriseScimIdentityDoc,
  vEnterpriseSecretDoc,
  vEnterpriseSecretKind,
  vEnterpriseStatus,
  vEnterpriseWebhookDeliveryDoc,
  vEnterpriseWebhookEndpointDoc,
  vGroupDoc,
  vGroupInviteDoc,
  vGroupMemberDoc,
  vInviteAcceptByTokenResult,
  vInviteStatus,
  vPasskeyDoc,
  vRateLimitResult,
  vRefreshTokenDoc,
  vScimResourceType,
  vScimStatus,
  vSessionDoc,
  vTag,
  vTotpFactorDoc,
  vUserDoc,
  vVerificationCodeDoc,
  vWebhookEndpointStatus,
};
export type { Id };

export const vPaginated = (item: any) =>
  v.object({
    items: v.array(item),
    nextCursor: v.union(v.string(), v.null()),
  });

export type TagPair = { key: string; value: string };

export function normalizeTag(tag: TagPair): TagPair {
  return {
    key: tag.key.trim().toLowerCase(),
    value: tag.value.trim().toLowerCase(),
  };
}

export function normalizeTags(tags: TagPair[]): TagPair[] {
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
