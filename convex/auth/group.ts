import { createAuthGroupSso } from "@robelest/convex-auth/server";
import { ConvexError, v } from "convex/values";

import { api } from "../_generated/api";
import { query } from "../_generated/server";
import { auth as Auth } from "../auth";
import { auth } from "../auth/core";
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
} = createAuthGroupSso(Auth, {
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

export const signInLookup = query({
  args: {
    email: v.optional(v.string()),
    domain: v.optional(v.string()),
    redirectTo: v.optional(v.string()),
    loginHint: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      connectionId: v.string(),
      providerId: v.string(),
      protocol: v.union(v.literal("oidc"), v.literal("saml")),
      signInPath: v.string(),
      callbackPath: v.string(),
      redirectTo: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    connectionId: string;
    providerId: string;
    protocol: "oidc" | "saml";
    signInPath: string;
    callbackPath: string;
    redirectTo?: string;
  } | null> => {
    try {
      return await ctx.runQuery(api.auth.group.signIn, args);
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data?.code === "INVALID_PARAMETERS" &&
        error.data?.message === "No group connection matched the provided input."
      ) {
        return null;
      }
      throw error;
    }
  },
});
