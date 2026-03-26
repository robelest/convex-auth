import type { EnterprisePolicy, EnterprisePolicyPatch } from "../types";
import { asRecord } from "./shared";

/** @internal */
export const DEFAULT_ENTERPRISE_POLICY: EnterprisePolicy = {
  version: 1,
  identity: {
    accountLinking: {
      oidc: "verifiedEmail",
      saml: "verifiedEmail",
    },
  },
  provisioning: {
    scimReuse: {
      user: "externalId",
    },
    jit: {
      mode: "createUserAndMembership",
      defaultRoleIds: [],
    },
    deprovision: {
      mode: "soft",
    },
  },
};

/** @internal */
export function normalizeEnterprisePolicy(policy: unknown): EnterprisePolicy {
  const input = asRecord(policy) ?? {};
  const identity = asRecord(input.identity) ?? {};
  const accountLinking = asRecord(identity.accountLinking) ?? {};
  const provisioning = asRecord(input.provisioning) ?? {};
  const scimReuse = asRecord(provisioning.scimReuse) ?? {};
  const jit = asRecord(provisioning.jit) ?? {};
  const deprovision = asRecord(provisioning.deprovision) ?? {};
  const extend = asRecord(input.extend) ?? undefined;

  return {
    version: 1,
    identity: {
      accountLinking: {
        oidc:
          accountLinking.oidc === "none"
            ? "none"
            : DEFAULT_ENTERPRISE_POLICY.identity.accountLinking.oidc,
        saml:
          accountLinking.saml === "none"
            ? "none"
            : DEFAULT_ENTERPRISE_POLICY.identity.accountLinking.saml,
      },
    },
    provisioning: {
      scimReuse: {
        user:
          scimReuse.user === "none"
            ? "none"
            : DEFAULT_ENTERPRISE_POLICY.provisioning.scimReuse.user,
      },
      jit: {
        mode:
          jit.mode === "off" ||
          jit.mode === "createUser" ||
          jit.mode === "createUserAndMembership"
            ? jit.mode
            : DEFAULT_ENTERPRISE_POLICY.provisioning.jit.mode,
        defaultRoleIds: Array.isArray(jit.defaultRoleIds)
          ? Array.from(
              new Set(
                jit.defaultRoleIds.filter(
                  (value): value is string =>
                    typeof value === "string" && value.length > 0,
                ),
              ),
            )
          : typeof jit.defaultRole === "string" && jit.defaultRole.length > 0
            ? [jit.defaultRole]
            : DEFAULT_ENTERPRISE_POLICY.provisioning.jit.defaultRoleIds,
      },
      deprovision: {
        mode:
          deprovision.mode === "hard"
            ? "hard"
            : DEFAULT_ENTERPRISE_POLICY.provisioning.deprovision.mode,
      },
    },
    ...(extend ? { extend } : {}),
  };
}

/** @internal */
export function patchEnterprisePolicy(
  current: unknown,
  patch: EnterprisePolicyPatch,
): EnterprisePolicy {
  const base = normalizeEnterprisePolicy(current);
  return normalizeEnterprisePolicy({
    ...base,
    ...patch,
    identity: {
      ...base.identity,
      ...patch.identity,
      accountLinking: {
        ...base.identity.accountLinking,
        ...patch.identity?.accountLinking,
      },
    },
    provisioning: {
      ...base.provisioning,
      ...patch.provisioning,
      scimReuse: {
        ...base.provisioning.scimReuse,
        ...patch.provisioning?.scimReuse,
      },
      jit: {
        ...base.provisioning.jit,
        ...patch.provisioning?.jit,
      },
      deprovision: {
        ...base.provisioning.deprovision,
        ...patch.provisioning?.deprovision,
      },
    },
    extend:
      patch.extend === undefined
        ? base.extend
        : { ...base.extend, ...patch.extend },
  });
}
