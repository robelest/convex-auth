import { v } from "convex/values";

/** @internal Shared validator for mounted enterprise connection status fields. */
export const enterpriseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("disabled"),
);

/** @internal Structured validator for mounted enterprise policy patch payloads. */
export const enterprisePolicyPatchValidator = v.object({
  identity: v.optional(
    v.object({
      accountLinking: v.optional(
        v.object({
          oidc: v.optional(
            v.union(v.literal("verifiedEmail"), v.literal("none")),
          ),
          saml: v.optional(
            v.union(v.literal("verifiedEmail"), v.literal("none")),
          ),
        }),
      ),
    }),
  ),
  provisioning: v.optional(
    v.object({
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
          defaultRole: v.optional(v.string()),
        }),
      ),
      deprovision: v.optional(
        v.object({
          mode: v.optional(v.union(v.literal("soft"), v.literal("hard"))),
        }),
      ),
    }),
  ),
});

/** @internal Filter validator for mounted enterprise connection list queries. */
export const enterpriseConnectionWhereValidator = v.object({
  groupId: v.optional(v.string()),
  slug: v.optional(v.string()),
  status: v.optional(enterpriseStatusValidator),
});

/** @internal Domain replacement input validator for mounted enterprise APIs. */
export const enterpriseDomainInputValidator = v.object({
  domain: v.string(),
  isPrimary: v.optional(v.boolean()),
  verifiedAt: v.optional(v.number()),
});

/** @internal SAML attribute mapping validator for mounted SSO admin APIs. */
export const enterpriseSamlAttributeMappingValidator = v.object({
  subject: v.optional(v.string()),
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
});

/** @internal SAML service-provider override validator for mounted admin APIs. */
export const enterpriseSamlSpValidator = v.object({
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
