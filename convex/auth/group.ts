import { group } from "@robelest/convex-auth/server";

import { auth, authorized } from "../auth";
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
} = group(auth, {
  admin: {
    authorized,
    roles: [roles.orgAdmin],
  },
});
