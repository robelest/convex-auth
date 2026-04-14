import { createAuthGroupSso } from "@robelest/convex-auth/server";

import { auth } from "../auth";
import { roles } from "../roles";

export const {
  createConnection,
  getConnection,
  getConnectionByDomain,
  listConnections,
  updateConnection,
  deleteConnection,
  getConnectionStatus,
  listDomains,
  validateDomains,
  setDomains,
  requestDomainVerification,
  confirmDomainVerification,
  configureOidc,
  getOidc,
  validateOidc,
  configureSaml,
  validateSaml,
  getPolicy,
  updatePolicy,
  validatePolicy,
  listAudit,
  createWebhookEndpoint,
  listWebhookEndpoints,
  listWebhookDeliveries,
  disableWebhookEndpoint,
  configureScim,
  getScim,
  validateScim,
  signIn,
  metadata,
} = createAuthGroupSso(auth, {
  permissions: {
    sso: { require: [roles.orgAdmin] },
    scim: { require: [roles.orgAdmin] },
  },
  access: async (ctx, input, requiredRoles) => {
    if (!input.groupId) {
      throw new Error("Group scope required.");
    }
    await auth.member.require(ctx as never, {
      userId: input.userId,
      groupId: input.groupId,
      roleIds: requiredRoles.map((role) => role.id),
    });
  },
});
