import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { AuthApi } from "./auth";
import {
  enterpriseConnectionWhereValidator,
  enterpriseDomainInputValidator,
  enterpriseDomainVerificationInputValidator,
  enterprisePolicyPatchValidator,
  enterpriseSamlAttributeMappingValidator,
  enterpriseSamlSpValidator,
  enterpriseStatusValidator,
} from "./enterprise/validators";
import type { AuthAuthorizationConfig, AuthRoleId } from "./types";

/**
 * Permission identifiers used by mounted enterprise admin APIs.
 *
 * These permission strings are passed to your {@link EnterpriseAuthorizer}
 * callback so app code can decide whether the current user may perform a
 * specific SSO or SCIM management operation.
 *
 * @example
 * ```ts
 * const authorized: EnterpriseAuthorizer = async (ctx, input) => {
 *   if (input.permission === "sso.connection.create") {
 *     // Only org admins may create SSO connections
 *   }
 * };
 * ```
 */
export type EnterpriseAdminPermission =
  | "sso.connection.create"
  | "sso.connection.read"
  | "sso.connection.manage"
  | "sso.domain.manage"
  | "sso.protocol.manage"
  | "sso.policy.manage"
  | "sso.audit.read"
  | "sso.webhook.manage"
  | "scim.manage";

/**
 * Input passed to an {@link EnterpriseAuthorizer}.
 *
 * Contains the acting user, the requested permission, and the resolved
 * enterprise/group scope for the operation being authorized.
 */
export type EnterpriseAdminAuthorizationInput = {
  /** The signed-in user's ID performing the admin action. */
  userId: string;
  /** The {@link EnterpriseAdminPermission} being requested. */
  permission: EnterpriseAdminPermission;
  /** Enterprise document ID, if the operation targets a specific enterprise. */
  enterpriseId?: string;
  /** Group document ID, if explicitly provided by the caller. */
  groupId?: string;
  /** Resolved group ID from the enterprise record, or `null` when no enterprise context. */
  resolvedGroupId: string | null;
};

/**
 * App-defined authorization hook for mounted enterprise admin APIs.
 *
 * Return `void` (or resolve) to allow the operation, or `{ ok: false }` to deny it.
 *
 * @param ctx - Convex context with `ctx.auth` for identity checks.
 * @param input - The {@link EnterpriseAdminAuthorizationInput} describing who is doing what.
 * @returns `void` to allow, `{ ok: false }` to deny.
 *
 * @example
 * ```ts
 * import { EnterpriseAuthorizer } from "@robelest/convex-auth/server";
 *
 * const authorized: EnterpriseAuthorizer = async (ctx, input) => {
 *   const identity = await ctx.auth.getUserIdentity();
 *   if (!identity) return { ok: false };
 *   // Allow all admin ops for the org owner
 * };
 * ```
 */
export type EnterpriseAuthorizer = (
  ctx: { auth: import("convex/server").Auth },
  input: EnterpriseAdminAuthorizationInput,
) => Promise<void | { ok: false }>;

type RoleRef<TRoleId extends string> = { id: TRoleId };

type MountedEnterpriseOptions<TRoleId extends string = string> = {
  admin?: {
    authorized?: EnterpriseAuthorizer;
    roles?: Array<TRoleId | RoleRef<TRoleId>>;
  };
};

/**
 * Configuration for {@link enterprise}, {@link sso}, and {@link scim}
 * mounted admin APIs.
 *
 * @typeParam TRoleId - Role IDs that may be assigned to enterprise creators.
 *
 * @example
 * ```ts
 * import { enterprise, EnterpriseMountOptions } from "@robelest/convex-auth/server";
 *
 * const options: EnterpriseMountOptions = {
 *   admin: {
 *     authorized: async (ctx, input) => {
 *       // Verify the user has permission for `input.permission`
 *     },
 *     roles: ["admin", "owner"],
 *   },
 * };
 * ```
 */
export type EnterpriseMountOptions<TRoleId extends string = string> = {
  admin: {
    authorized: EnterpriseAuthorizer;
    roles?: Array<TRoleId | RoleRef<TRoleId>>;
  };
};

type MountedEnterpriseTarget = {
  enterpriseId?: string;
  groupId?: string;
  domain?: string;
};

function requireSignedInUser(auth: Pick<AuthApi, "user">) {
  return async (ctx: {
    auth: import("convex/server").Auth;
  }): Promise<string | null> => {
    return await auth.user.id(ctx as never);
  };
}

function normalizeCreatorRoleIds<TRoleId extends string>(
  roles?: Array<TRoleId | RoleRef<TRoleId>>,
) {
  return roles?.map((role) => (typeof role === "string" ? role : role.id));
}

async function resolveMountedEnterpriseTarget(
  auth: Pick<AuthApi, "sso">,
  ctx: { auth: import("convex/server").Auth },
  target: MountedEnterpriseTarget,
) {
  if (target.groupId !== undefined) {
    return {
      enterpriseId: target.enterpriseId,
      groupId: target.groupId,
      resolvedGroupId: target.groupId,
    };
  }

  if (target.enterpriseId !== undefined) {
    const enterprise = await auth.sso.admin.connection.get(
      ctx as never,
      target.enterpriseId,
    );
    if (enterprise === null) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Enterprise not found.",
      });
    }
    return {
      enterpriseId: enterprise._id,
      groupId: enterprise.groupId,
      resolvedGroupId: enterprise.groupId,
    };
  }

  if (target.domain !== undefined) {
    const resolved = await auth.sso.admin.connection.getByDomain(
      ctx as never,
      target.domain,
    );
    if (resolved?.enterprise === undefined) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Enterprise not found.",
      });
    }
    return {
      enterpriseId: resolved.enterprise._id,
      groupId: resolved.enterprise.groupId,
      resolvedGroupId: resolved.enterprise.groupId,
    };
  }

  return {
    enterpriseId: undefined,
    groupId: undefined,
    resolvedGroupId: null,
  };
}

function createMountedAdminAuthorizer(
  auth: Pick<AuthApi, "sso" | "user">,
  options?: MountedEnterpriseOptions,
) {
  const requireUserId = requireSignedInUser(auth);

  return async (
    ctx: { auth: import("convex/server").Auth },
    permission: EnterpriseAdminPermission,
    target: MountedEnterpriseTarget = {},
  ) => {
    const userId = await requireUserId(ctx);
    if (userId === null) {
      return { ok: false as const, code: "NOT_SIGNED_IN" as const };
    }
    if (!options?.admin?.authorized) {
      return { ok: false as const, code: "FORBIDDEN" as const };
    }
    const resolved = await resolveMountedEnterpriseTarget(auth, ctx, target);
    const authResult = await options.admin.authorized(ctx, {
      userId,
      permission,
      enterpriseId: resolved.enterpriseId,
      groupId: resolved.groupId,
      resolvedGroupId: resolved.resolvedGroupId,
    });
    if (authResult && !authResult.ok) {
      return { ok: false as const, code: "FORBIDDEN" as const };
    }
    return { ok: true as const, userId, ...resolved };
  };
}

/**
 * Build optional public SSO management actions that apps can mount under
 * `convex/auth/sso/**` when they want client-callable enterprise APIs.
 *
 * `admin` is for tenant-admin control-plane operations and should be mounted
 * with an explicit authorization policy. `client` is for end-user sign-in
 * helpers and does not require tenant-admin authorization.
 *
 * @param auth - Auth API subset providing `group`, `member`, `sso`, and `user` namespaces.
 * @param options - Optional admin authorization config. See {@link EnterpriseMountOptions}.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @returns An object with `admin` (connection CRUD, OIDC/SAML protocol config, policy,
 *   audit, webhooks, domain management) and `client` (signIn, metadata) namespaces.
 *
 * @example
 * ```ts
 * // convex/auth/sso.ts
 * import { sso } from "@robelest/convex-auth/server";
 * import { auth } from "../auth";
 *
 * const mounted = sso(auth, {
 *   admin: {
 *     authorized: async (ctx, input) => { /* check permissions *\/ },
 *   },
 * });
 *
 * export const createConnection = mounted.admin.connection.create;
 * export const signIn = mounted.client.signIn;
 * ```
 *
 * @see {@link scim}
 * @see {@link enterprise}
 */
export function sso<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  auth: Pick<AuthApi<TAuthorization>, "group" | "member" | "sso" | "user">,
  options?: MountedEnterpriseOptions<AuthRoleId<TAuthorization>>,
) {
  const authorize = createMountedAdminAuthorizer(auth, options);
  const adminRoleIds = normalizeCreatorRoleIds(options?.admin?.roles);

  return {
    admin: {
      connection: {
        create: mutationGeneric({
          args: {
            groupId: v.optional(v.string()),
            name: v.optional(v.string()),
            slug: v.optional(v.string()),
            status: v.optional(enterpriseStatusValidator),
            domain: v.optional(v.string()),
          },
          handler: async (ctx, args) => {
            const authResult = await authorize(ctx, "sso.connection.create", {
              groupId: args.groupId,
            });
            if (!authResult.ok)
              return { ok: false as const, code: authResult.code };
            const { userId } = authResult;
            const createsGroup = args.groupId === undefined;
            const groupId =
              args.groupId ??
              (
                await auth.group.create(ctx as never, {
                  name: args.name?.trim() || args.slug?.trim() || "Enterprise",
                  slug: args.slug,
                  type: "enterprise",
                })
              ).groupId;
            if (createsGroup) {
              await auth.member.create(ctx as never, {
                groupId,
                userId,
                roleIds: adminRoleIds,
              });
            }
            const created = await auth.sso.admin.connection.create(
              ctx as never,
              {
                groupId,
                name: args.name,
                slug: args.slug,
                status: args.status,
              },
            );
            if (args.domain) {
              await auth.sso.admin.connection.domain.set(
                ctx as never,
                created.enterpriseId,
                [{ domain: args.domain, isPrimary: true }],
              );
            }
            return {
              ...created,
              groupId,
              createdGroup: createsGroup,
            };
          },
        }),
        get: queryGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.connection.get(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
        getByGroup: queryGeneric({
          args: { groupId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              groupId: args.groupId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.connection.getByGroup(
              ctx as never,
              args.groupId,
            );
          },
        }),
        getByDomain: queryGeneric({
          args: { domain: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              domain: args.domain,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.connection.getByDomain(
              ctx as never,
              args.domain,
            );
          },
        }),
        list: queryGeneric({
          args: {
            where: v.optional(enterpriseConnectionWhereValidator),
            limit: v.optional(v.number()),
            cursor: v.optional(v.union(v.string(), v.null())),
            orderBy: v.optional(v.string()),
            order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
          },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              groupId: args.where?.groupId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.connection.list(
              ctx as never,
              args as never,
            );
          },
        }),
        update: mutationGeneric({
          args: {
            enterpriseId: v.string(),
            data: v.object({
              name: v.optional(v.string()),
              slug: v.optional(v.string()),
              status: v.optional(enterpriseStatusValidator),
            }),
          },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return { ok: false as const, code: _auth.code };
            await auth.sso.admin.connection.update(
              ctx as never,
              args.enterpriseId,
              args.data,
            );
            return { ok: true as const, enterpriseId: args.enterpriseId };
          },
        }),
        delete: mutationGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return { ok: false as const, code: _auth.code };
            return await auth.sso.admin.connection.delete(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
        status: queryGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.connection.status(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
        domain: {
          list: queryGeneric({
            args: { enterpriseId: v.string() },
            handler: async (ctx, args) => {
              const _auth = await authorize(ctx, "sso.connection.read", {
                enterpriseId: args.enterpriseId,
              });
              if (!_auth.ok) return null;
              return await auth.sso.admin.connection.domain.list(
                ctx as never,
                args.enterpriseId,
              );
            },
          }),
          validate: queryGeneric({
            args: { enterpriseId: v.string() },
            handler: async (ctx, args) => {
              const _auth = await authorize(ctx, "sso.domain.manage", {
                enterpriseId: args.enterpriseId,
              });
              if (!_auth.ok) return null;
              return await auth.sso.admin.connection.domain.validate(
                ctx as never,
                args.enterpriseId,
              );
            },
          }),
          set: mutationGeneric({
            args: {
              enterpriseId: v.string(),
              domains: v.array(enterpriseDomainInputValidator),
            },
            handler: async (ctx, args) => {
              const _auth = await authorize(ctx, "sso.domain.manage", {
                enterpriseId: args.enterpriseId,
              });
              if (!_auth.ok) return { ok: false as const, code: _auth.code };
              return await auth.sso.admin.connection.domain.set(
                ctx as never,
                args.enterpriseId,
                args.domains,
              );
            },
          }),
          verification: {
            request: mutationGeneric({
              args: enterpriseDomainVerificationInputValidator,
              handler: async (ctx, args) => {
                const _auth = await authorize(ctx, "sso.domain.manage", {
                  enterpriseId: args.enterpriseId,
                });
                if (!_auth.ok) return { ok: false as const, code: _auth.code };
                return await auth.sso.admin.connection.domain.verification.request(
                  ctx as never,
                  args,
                );
              },
            }),
            confirm: actionGeneric({
              args: enterpriseDomainVerificationInputValidator,
              handler: async (ctx, args) => {
                const _auth = await authorize(ctx, "sso.domain.manage", {
                  enterpriseId: args.enterpriseId,
                });
                if (!_auth.ok) return { ok: false as const, code: _auth.code };
                return await auth.sso.admin.connection.domain.verification.confirm(
                  ctx as never,
                  args,
                );
              },
            }),
          },
        },
      },
      oidc: {
        configure: mutationGeneric({
          args: {
            enterpriseId: v.string(),
            issuer: v.optional(v.string()),
            discoveryUrl: v.optional(v.string()),
            clientId: v.string(),
            clientSecret: v.optional(v.string()),
            scopes: v.optional(v.array(v.string())),
            authorizationParams: v.optional(v.record(v.string(), v.string())),
            clockToleranceSeconds: v.optional(v.number()),
            strictIssuer: v.optional(v.boolean()),
            extraFields: v.optional(v.record(v.string(), v.string())),
          },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.protocol.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return { ok: false as const, code: _auth.code };
            return await auth.sso.admin.oidc.configure(ctx as never, args);
          },
        }),
        get: queryGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.oidc.get(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
        validate: actionGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.protocol.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return { ok: false as const, code: _auth.code };
            return await auth.sso.admin.oidc.validate(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
      },
      saml: {
        configure: actionGeneric({
          args: {
            enterpriseId: v.string(),
            metadataXml: v.optional(v.string()),
            metadataUrl: v.optional(v.string()),
            domains: v.optional(v.array(v.string())),
            signAuthnRequests: v.optional(v.boolean()),
            attributeMapping: v.optional(
              enterpriseSamlAttributeMappingValidator,
            ),
            sp: v.optional(enterpriseSamlSpValidator),
          },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.protocol.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return { ok: false as const, code: _auth.code };
            return await auth.sso.admin.saml.configure(ctx as never, args);
          },
        }),
        validate: queryGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.protocol.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.saml.validate(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
      },
      policy: {
        get: queryGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.connection.read", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.policy.get(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
        update: mutationGeneric({
          args: {
            enterpriseId: v.string(),
            patch: enterprisePolicyPatchValidator,
          },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.policy.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return { ok: false as const, code: _auth.code };
            return await auth.sso.admin.policy.update(
              ctx as never,
              args.enterpriseId,
              args.patch,
            );
          },
        }),
        validate: queryGeneric({
          args: { enterpriseId: v.string() },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.policy.manage", {
              enterpriseId: args.enterpriseId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.policy.validate(
              ctx as never,
              args.enterpriseId,
            );
          },
        }),
      },
      audit: {
        list: queryGeneric({
          args: {
            enterpriseId: v.optional(v.string()),
            groupId: v.optional(v.string()),
            limit: v.optional(v.number()),
          },
          handler: async (ctx, args) => {
            const _auth = await authorize(ctx, "sso.audit.read", {
              enterpriseId: args.enterpriseId,
              groupId: args.groupId,
            });
            if (!_auth.ok) return null;
            return await auth.sso.admin.audit.list(ctx as never, args);
          },
        }),
      },
      webhook: {
        delivery: {
          list: queryGeneric({
            args: {
              enterpriseId: v.string(),
              limit: v.optional(v.number()),
            },
            handler: async (ctx, args) => {
              const _auth = await authorize(ctx, "sso.webhook.manage", {
                enterpriseId: args.enterpriseId,
              });
              if (!_auth.ok) return null;
              return await (auth.sso.admin.webhook as any).delivery.list(
                ctx as never,
                args,
              );
            },
          }),
        },
        endpoint: {
          create: mutationGeneric({
            args: {
              enterpriseId: v.string(),
              url: v.string(),
              secret: v.string(),
              subscriptions: v.array(v.string()),
              createdByUserId: v.optional(v.string()),
            },
            handler: async (ctx, args) => {
              const authResult = await authorize(ctx, "sso.webhook.manage", {
                enterpriseId: args.enterpriseId,
              });
              if (!authResult.ok)
                return { ok: false as const, code: authResult.code };
              const { userId } = authResult;
              const result = await auth.sso.admin.webhook.endpoint.create(
                ctx as never,
                {
                  ...args,
                  createdByUserId: args.createdByUserId ?? userId,
                },
              );
              return {
                _id: result.endpointId,
                enterpriseId: args.enterpriseId,
                url: args.url,
                subscriptions: args.subscriptions,
                createdByUserId: args.createdByUserId ?? userId,
                status: "active",
                failureCount: 0,
              };
            },
          }),
          list: queryGeneric({
            args: { enterpriseId: v.string() },
            handler: async (ctx, args) => {
              const _auth = await authorize(ctx, "sso.webhook.manage", {
                enterpriseId: args.enterpriseId,
              });
              if (!_auth.ok) return null;
              const endpoints = await auth.sso.admin.webhook.endpoint.list(
                ctx as never,
                args.enterpriseId,
              );
              return endpoints.map((endpoint: Record<string, unknown>) => {
                const { secretHash: _secretHash, ...rest } = endpoint;
                return rest;
              });
            },
          }),
          disable: mutationGeneric({
            args: { endpointId: v.string() },
            handler: async (ctx, args) => {
              const endpoint = await auth.sso.admin.webhook.endpoint.get(
                ctx as never,
                args.endpointId,
              );
              if (!endpoint) {
                return {
                  ok: false as const,
                  code: "INVALID_PARAMETERS" as const,
                };
              }
              const _auth = await authorize(ctx, "sso.webhook.manage", {
                enterpriseId: endpoint.enterpriseId,
                groupId: endpoint.groupId,
              });
              if (!_auth.ok) return { ok: false as const, code: _auth.code };
              return await auth.sso.admin.webhook.endpoint.disable(
                ctx as never,
                args.endpointId,
              );
            },
          }),
        },
      },
    },
    client: {
      signIn: queryGeneric({
        args: {
          enterpriseId: v.optional(v.string()),
          email: v.optional(v.string()),
          domain: v.optional(v.string()),
          redirectTo: v.optional(v.string()),
        },
        handler: async (ctx, args) => {
          return await auth.sso.client.signIn(ctx as never, args);
        },
      }),
      metadata: queryGeneric({
        args: {
          enterpriseId: v.string(),
          entityId: v.optional(v.string()),
          acsUrl: v.optional(v.string()),
          sloUrl: v.optional(v.string()),
        },
        handler: async (ctx, args) => {
          return await auth.sso.client.metadata(ctx as never, args);
        },
      }),
    },
  };
}

/**
 * Build optional public SCIM management actions that apps can mount under
 * `convex/auth/scim/**` when they want client-callable enterprise admin APIs.
 *
 * @param auth - Auth API subset providing `scim`, `sso`, and `user` namespaces.
 * @param options - Optional admin authorization config. See {@link EnterpriseMountOptions}.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @returns An object with `admin.configure`, `admin.get`, and `admin.validate` actions.
 *
 * @example
 * ```ts
 * // convex/auth/scim.ts
 * import { scim } from "@robelest/convex-auth/server";
 * import { auth } from "../auth";
 *
 * const mounted = scim(auth, {
 *   admin: {
 *     authorized: async (ctx, input) => { /* check permissions *\/ },
 *   },
 * });
 *
 * export const configure = mounted.admin.configure;
 * export const get = mounted.admin.get;
 * export const validate = mounted.admin.validate;
 * ```
 *
 * @see {@link sso}
 * @see {@link enterprise}
 */
export function scim<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  auth: Pick<AuthApi<TAuthorization>, "scim" | "sso" | "user">,
  options?: MountedEnterpriseOptions<AuthRoleId<TAuthorization>>,
) {
  const authorize = createMountedAdminAuthorizer(auth, options);

  return {
    admin: {
      configure: mutationGeneric({
        args: {
          enterpriseId: v.string(),
          basePath: v.optional(v.string()),
          status: v.optional(enterpriseStatusValidator),
        },
        handler: async (ctx, args) => {
          const _auth = await authorize(ctx, "scim.manage", {
            enterpriseId: args.enterpriseId,
          });
          if (!_auth.ok) return { ok: false as const, code: _auth.code };
          return await auth.scim.admin.configure(ctx as never, args);
        },
      }),
      get: queryGeneric({
        args: { enterpriseId: v.string() },
        handler: async (ctx, args) => {
          const _auth = await authorize(ctx, "scim.manage", {
            enterpriseId: args.enterpriseId,
          });
          if (!_auth.ok) return null;
          return await auth.scim.admin.get(ctx as never, args.enterpriseId);
        },
      }),
      validate: queryGeneric({
        args: { enterpriseId: v.string() },
        handler: async (ctx, args) => {
          const _auth = await authorize(ctx, "scim.manage", {
            enterpriseId: args.enterpriseId,
          });
          if (!_auth.ok) return null;
          return await auth.scim.admin.validate(
            ctx as never,
            args.enterpriseId,
          );
        },
      }),
    },
  };
}

/**
 * Build a flat mounted enterprise API surface for app-owned Convex exports.
 *
 * Combines {@link sso} and {@link scim} into a single flat object with
 * all SSO connection, protocol, policy, audit, webhook, and SCIM
 * management functions plus end-user sign-in helpers. The `authorized`
 * callback is required for all admin operations.
 *
 * @param auth - Auth API subset providing `group`, `member`, `scim`, `sso`, and `user` namespaces.
 * @param options - Required {@link EnterpriseMountOptions} with an `admin.authorized` callback.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @returns A flat object with all enterprise management functions (e.g. `createConnection`,
 *   `configureOidc`, `configureScim`, `signIn`, etc.).
 *
 * @example
 * ```ts
 * // convex/auth/enterprise.ts
 * import { enterprise } from "@robelest/convex-auth/server";
 * import { auth } from "../auth";
 *
 * const api = enterprise(auth, {
 *   admin: {
 *     authorized: async (ctx, input) => { /* check permissions *\/ },
 *     roles: ["admin"],
 *   },
 * });
 *
 * export const createConnection = api.createConnection;
 * export const configureOidc = api.configureOidc;
 * export const signIn = api.signIn;
 * ```
 *
 * @see {@link sso}
 * @see {@link scim}
 */
export function enterprise<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  auth: Pick<
    AuthApi<TAuthorization>,
    "group" | "member" | "scim" | "sso" | "user"
  >,
  options: EnterpriseMountOptions<AuthRoleId<TAuthorization>>,
) {
  const mountedSso = sso(auth, {
    admin: options.admin,
  });
  const mountedScim = scim(auth, {
    admin: { authorized: options.admin.authorized },
  });

  return {
    createConnection: mountedSso.admin.connection.create,
    getConnection: mountedSso.admin.connection.get,
    getConnectionByGroup: mountedSso.admin.connection.getByGroup,
    getConnectionByDomain: mountedSso.admin.connection.getByDomain,
    listConnections: mountedSso.admin.connection.list,
    updateConnection: mountedSso.admin.connection.update,
    deleteConnection: mountedSso.admin.connection.delete,
    getConnectionStatus: mountedSso.admin.connection.status,
    listDomains: mountedSso.admin.connection.domain.list,
    validateDomains: mountedSso.admin.connection.domain.validate,
    setDomains: mountedSso.admin.connection.domain.set,
    requestDomainVerification:
      mountedSso.admin.connection.domain.verification.request,
    confirmDomainVerification:
      mountedSso.admin.connection.domain.verification.confirm,
    configureOidc: mountedSso.admin.oidc.configure,
    getOidc: mountedSso.admin.oidc.get,
    validateOidc: mountedSso.admin.oidc.validate,
    configureSaml: mountedSso.admin.saml.configure,
    validateSaml: mountedSso.admin.saml.validate,
    getPolicy: mountedSso.admin.policy.get,
    updatePolicy: mountedSso.admin.policy.update,
    validatePolicy: mountedSso.admin.policy.validate,
    listAudit: mountedSso.admin.audit.list,
    createWebhookEndpoint: mountedSso.admin.webhook.endpoint.create,
    listWebhookEndpoints: mountedSso.admin.webhook.endpoint.list,
    listWebhookDeliveries: mountedSso.admin.webhook.delivery.list,
    disableWebhookEndpoint: mountedSso.admin.webhook.endpoint.disable,
    configureScim: mountedScim.admin.configure,
    getScim: mountedScim.admin.get,
    validateScim: mountedScim.admin.validate,
    signIn: mountedSso.client.signIn,
    metadata: mountedSso.client.metadata,
  };
}
