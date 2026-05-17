import { v } from "convex/values";

/** @internal Shared validator for mounted group connection status fields. */
export const groupConnectionStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("disabled"),
);

/** @internal Structured validator for mounted group policy patch payloads. */
export const groupPolicyPatchValidator = v.object({
  identity: v.optional(
    v.object({
      accountLinking: v.optional(
        v.object({
          oidc: v.optional(
            v.union(
              v.literal("verifiedEmail"),
              v.literal("none"),
              v.literal("sameConnection"),
            ),
          ),
          saml: v.optional(
            v.union(
              v.literal("verifiedEmail"),
              v.literal("none"),
              v.literal("sameConnection"),
            ),
          ),
        }),
      ),
    }),
  ),
  provisioning: v.optional(
    v.object({
      user: v.optional(
        v.object({
          createOnSignIn: v.optional(v.boolean()),
          updateProfileOnLogin: v.optional(
            v.union(v.literal("never"), v.literal("missing"), v.literal("always")),
          ),
          updateProfileFromScim: v.optional(
            v.union(v.literal("never"), v.literal("missing"), v.literal("always")),
          ),
          authority: v.optional(v.union(v.literal("app"), v.literal("sso"), v.literal("scim"))),
        }),
      ),
      scimReuse: v.optional(
        v.object({
          user: v.optional(v.union(v.literal("externalId"), v.literal("none"))),
        }),
      ),
      jit: v.optional(
        v.object({
          mode: v.optional(
            v.union(
              v.literal("off"),
              v.literal("createUser"),
              v.literal("createUserAndMembership"),
            ),
          ),
          defaultRoleIds: v.optional(v.array(v.string())),
        }),
      ),
      deprovision: v.optional(
        v.object({
          mode: v.optional(v.union(v.literal("soft"), v.literal("hard"))),
        }),
      ),
      groups: v.optional(
        v.object({
          mode: v.optional(v.union(v.literal("ignore"), v.literal("sync"))),
          source: v.optional(v.literal("protocol")),
          mapping: v.optional(v.record(v.string(), v.array(v.string()))),
        }),
      ),
      roles: v.optional(
        v.object({
          mode: v.optional(v.union(v.literal("ignore"), v.literal("map"))),
          source: v.optional(v.literal("protocol")),
          mapping: v.optional(v.record(v.string(), v.array(v.string()))),
        }),
      ),
    }),
  ),
});

/** @internal Filter validator for mounted group connection list queries. */
export const groupConnectionWhereValidator = v.object({
  groupId: v.optional(v.string()),
  slug: v.optional(v.string()),
  status: v.optional(groupConnectionStatusValidator),
});

/** @internal Domain replacement input validator for mounted connection APIs. */
export const groupConnectionDomainInputValidator = v.object({
  domain: v.string(),
  isPrimary: v.optional(v.boolean()),
});

/** @internal Input validator for connection domain verification actions. */
export const groupConnectionDomainVerificationInputValidator = v.object({
  connectionId: v.string(),
  domain: v.string(),
});

/** @internal SAML attribute mapping validator for mounted SSO admin APIs. */
export const ssoSamlAttributeMappingValidator = v.object({
  subject: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  image: v.optional(v.string()),
  groups: v.optional(v.string()),
  roles: v.optional(v.string()),
});

/** @internal SAML service-provider override validator for mounted admin APIs. */
export const ssoSamlSpValidator = v.object({
  entityId: v.optional(v.string()),
  acsUrl: v.optional(v.string()),
  sloUrl: v.optional(v.string()),
  signingCert: v.optional(v.union(v.string(), v.array(v.string()))),
  encryptCert: v.optional(v.union(v.string(), v.array(v.string()))),
  privateKey: v.optional(v.string()),
  privateKeyPass: v.optional(v.string()),
  encPrivateKey: v.optional(v.string()),
  encPrivateKeyPass: v.optional(v.string()),
});

/** @internal SAML security validator for mounted admin APIs. */
export const ssoSamlSecurityValidator = v.object({
  requireSignedAssertions: v.optional(v.boolean()),
  requireTimestamps: v.optional(v.boolean()),
  clockSkewSeconds: v.optional(v.number()),
  weakAlgorithmHandling: v.optional(v.union(v.literal("warn"), v.literal("reject"))),
  maxMetadataSize: v.optional(v.number()),
  maxResponseSize: v.optional(v.number()),
});
