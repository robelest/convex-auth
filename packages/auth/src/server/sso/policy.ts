import type { GroupConnectionPolicy, GroupConnectionPolicyPatch } from "../types";
import { asRecord } from "./shared";

export const DEFAULT_GROUP_CONNECTION_POLICY: GroupConnectionPolicy = {
  version: 1,
  identity: {
    accountLinking: {
      oidc: "verifiedEmail",
      saml: "verifiedEmail",
    },
  },
  provisioning: {
    user: {
      createOnSignIn: true,
      updateProfileOnLogin: "missing",
      updateProfileFromScim: "always",
      authority: "app",
    },
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
    groups: {
      mode: "ignore",
      source: "protocol",
    },
    roles: {
      mode: "ignore",
      source: "protocol",
    },
  },
};

export function normalizeGroupConnectionPolicy(policy: unknown): GroupConnectionPolicy {
  const input = asRecord(policy) ?? {};
  const identity = asRecord(input.identity) ?? {};
  const accountLinking = asRecord(identity.accountLinking) ?? {};
  const provisioning = asRecord(input.provisioning) ?? {};
  const scimReuse = asRecord(provisioning.scimReuse) ?? {};
  const user = asRecord(provisioning.user) ?? {};
  const jit = asRecord(provisioning.jit) ?? {};
  const deprovision = asRecord(provisioning.deprovision) ?? {};
  const groups = asRecord(provisioning.groups) ?? {};
  const roles = asRecord(provisioning.roles) ?? {};
  const extend = asRecord(input.extend) ?? undefined;

  return {
    version: 1,
    identity: {
      accountLinking: {
        oidc:
          accountLinking.oidc === "none"
            ? "none"
            : DEFAULT_GROUP_CONNECTION_POLICY.identity.accountLinking.oidc,
        saml:
          accountLinking.saml === "none"
            ? "none"
            : DEFAULT_GROUP_CONNECTION_POLICY.identity.accountLinking.saml,
      },
    },
    provisioning: {
      user: {
        createOnSignIn:
          typeof user.createOnSignIn === "boolean"
            ? user.createOnSignIn
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.user.createOnSignIn,
        updateProfileOnLogin:
          user.updateProfileOnLogin === "never" || user.updateProfileOnLogin === "always"
            ? user.updateProfileOnLogin
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.user.updateProfileOnLogin,
        updateProfileFromScim:
          user.updateProfileFromScim === "never" || user.updateProfileFromScim === "missing"
            ? user.updateProfileFromScim
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.user.updateProfileFromScim,
        authority:
          user.authority === "sso" || user.authority === "scim"
            ? user.authority
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.user.authority,
      },
      scimReuse: {
        user:
          scimReuse.user === "none"
            ? "none"
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.scimReuse.user,
      },
      jit: {
        mode:
          jit.mode === "off" || jit.mode === "createUser" || jit.mode === "createUserAndMembership"
            ? jit.mode
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.jit.mode,
        defaultRoleIds: Array.isArray(jit.defaultRoleIds)
          ? Array.from(
              new Set(
                jit.defaultRoleIds.filter(
                  (value): value is string => typeof value === "string" && value.length > 0,
                ),
              ),
            )
          : typeof jit.defaultRole === "string" && jit.defaultRole.length > 0
            ? [jit.defaultRole]
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.jit.defaultRoleIds,
      },
      deprovision: {
        mode:
          deprovision.mode === "hard"
            ? "hard"
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.deprovision.mode,
      },
      groups: {
        mode:
          groups.mode === "sync"
            ? "sync"
            : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.groups.mode,
        source: "protocol",
        ...(typeof groups.mapping === "object" && groups.mapping !== null
          ? {
              mapping: Object.fromEntries(
                Object.entries(groups.mapping)
                  .filter(([key, value]) => typeof key === "string" && Array.isArray(value))
                  .map(([key, value]) => [
                    key,
                    Array.from(
                      new Set(
                        (value as unknown[]).filter(
                          (item): item is string => typeof item === "string" && item.length > 0,
                        ),
                      ),
                    ),
                  ]),
              ),
            }
          : {}),
      },
      roles: {
        mode:
          roles.mode === "map" ? "map" : DEFAULT_GROUP_CONNECTION_POLICY.provisioning.roles.mode,
        source: "protocol",
        ...(typeof roles.mapping === "object" && roles.mapping !== null
          ? {
              mapping: Object.fromEntries(
                Object.entries(roles.mapping)
                  .filter(([key, value]) => typeof key === "string" && Array.isArray(value))
                  .map(([key, value]) => [
                    key,
                    Array.from(
                      new Set(
                        (value as unknown[]).filter(
                          (item): item is string => typeof item === "string" && item.length > 0,
                        ),
                      ),
                    ),
                  ]),
              ),
            }
          : {}),
      },
    },
    ...(extend ? { extend } : {}),
  };
}

export function patchGroupConnectionPolicy(
  current: unknown,
  patch: GroupConnectionPolicyPatch,
): GroupConnectionPolicy {
  const base = normalizeGroupConnectionPolicy(current);
  return normalizeGroupConnectionPolicy({
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
      user: {
        ...base.provisioning.user,
        ...patch.provisioning?.user,
      },
      jit: {
        ...base.provisioning.jit,
        ...patch.provisioning?.jit,
      },
      deprovision: {
        ...base.provisioning.deprovision,
        ...patch.provisioning?.deprovision,
      },
      groups: {
        ...base.provisioning.groups,
        ...patch.provisioning?.groups,
      },
      roles: {
        ...base.provisioning.roles,
        ...patch.provisioning?.roles,
      },
    },
    extend: patch.extend === undefined ? base.extend : { ...base.extend, ...patch.extend },
  });
}

export function resolveProvisionedRoleIds(opts: {
  policy: GroupConnectionPolicy;
  groups?: string[];
  roles?: string[];
}) {
  const roleIds = new Set<string>(opts.policy.provisioning.jit.defaultRoleIds);

  if (opts.policy.provisioning.groups.mode === "sync") {
    const mapping = opts.policy.provisioning.groups.mapping ?? {};
    for (const group of opts.groups ?? []) {
      for (const roleId of mapping[group] ?? []) {
        roleIds.add(roleId);
      }
    }
  }

  if (opts.policy.provisioning.roles.mode === "map") {
    const mapping = opts.policy.provisioning.roles.mapping ?? {};
    for (const role of opts.roles ?? []) {
      for (const roleId of mapping[role] ?? []) {
        roleIds.add(roleId);
      }
    }
  }

  return Array.from(roleIds);
}
