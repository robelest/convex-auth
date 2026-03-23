import { enterprise } from "@robelest/convex-auth/server";

import { auth, authorized } from "../auth";

export const {
  createConnection,
  getConnection,
  getConnectionByGroup,
  getConnectionByDomain,
  listConnections,
  updateConnection,
  deleteConnection,
  getConnectionStatus,
  listDomains,
  validateDomains,
  setDomains,
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
  disableWebhookEndpoint,
  configureScim,
  getScim,
  validateScim,
  signIn,
  metadata,
} = enterprise(auth, { authorized });
