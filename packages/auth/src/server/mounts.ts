import { Cv } from "@robelest/fx/convex";
import { actionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { AuthApi } from "./auth";
import {
  groupConnectionWhereValidator,
  groupConnectionDomainInputValidator,
  groupConnectionDomainVerificationInputValidator,
  groupPolicyPatchValidator,
  ssoSamlAttributeMappingValidator,
  ssoSamlSpValidator,
  groupConnectionStatusValidator,
} from "./sso/validators";
import type { AuthAuthorizationConfig, AuthRoleId } from "./types";

/**
 * Permission identifiers used by mounted group SSO admin APIs.
 *
 * These permission strings are passed to your {@link SsoAuthorizer}
 * callback so app code can decide whether the current user may perform a
 * specific SSO or SCIM management operation.
 *
 * @example
 * ```ts
 * const authorized: SsoAuthorizer = async (ctx, input) => {
 *   if (input.permission === "sso.connection.create") {
 *     // Only org admins may create SSO connections
 *   }
 * };
 * ```
 */
export type SsoAdminPermission =
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
 * Input passed to an {@link SsoAuthorizer}.
 *
 * Contains the acting user, the requested permission, and the resolved
 * group connection/group scope for the operation being authorized.
 */
export type SsoAdminAuthorizationInput = {
  /** The signed-in user's ID performing the admin action. */
  userId: string;
  /** The {@link SsoAdminPermission} being requested. */
  permission: SsoAdminPermission;
  /** Connection document ID, if the operation targets a specific SSO connection. */
  connectionId?: string;
  /** Group document ID, if explicitly provided by the caller. */
  groupId?: string;
  /** Resolved group ID from the connection record, or `null` when no connection context. */
  resolvedGroupId: string | null;
};

/**
 * App-defined authorization hook for mounted group SSO admin APIs.
 *
 * Return `void` (or resolve) to allow the operation, or throw to deny it.
 *
 * @param ctx - Convex context with `ctx.auth` for identity checks.
 * @param input - The {@link SsoAdminAuthorizationInput} describing who is doing what.
 * @returns `void` to allow; throw to deny.
 *
 * @example
 * ```ts
 * import { SsoAuthorizer } from "@robelest/convex-auth/server";
 *
 * const authorized: SsoAuthorizer = async (ctx, input) => {
 *   const identity = await ctx.auth.getUserIdentity();
 *   if (!identity) throw new Error("Forbidden");
 *   // Allow all admin ops for the org owner
 * };
 * ```
 */
export type SsoAuthorizer = (
  ctx: { auth: import("convex/server").Auth },
  input: SsoAdminAuthorizationInput,
) => Promise<void>;

type RoleRef<TRoleId extends string> = { id: TRoleId };

export type MountedGroupOptions<TRoleId extends string = string> = {
  admin?: {
    authorized?: SsoAuthorizer;
    roles?: Array<TRoleId | RoleRef<TRoleId>>;
  };
};

/**
 * Configuration for {@link group}, {@link sso}, and {@link scim}
 * mounted admin APIs.
 *
 * @typeParam TRoleId - Role IDs that may be assigned to group connection creators.
 *
 * @example
 * ```ts
 * import { group, GroupMountOptions } from "@robelest/convex-auth/server";
 *
 * const options: GroupMountOptions = {
 *   admin: {
 *     authorized: async (ctx, input) => {
 *       // Verify the user has permission for `input.permission`
 *     },
 *     roles: ["admin", "owner"],
 *   },
 * };
 * ```
 */
export type GroupMountOptions<TRoleId extends string = string> = {
  admin: {
    authorized: SsoAuthorizer;
    roles?: Array<TRoleId | RoleRef<TRoleId>>;
  };
};

type MountedGroupTarget = {
  connectionId?: string;
  groupId?: string;
  domain?: string;
};

function requireSignedInUser(auth: Pick<AuthApi, "context">) {
  return async (ctx: {
    auth: import("convex/server").Auth;
  }): Promise<string | null> => {
    return (await auth.context(ctx as never, { optional: true })).userId;
  };
}

function normalizeCreatorRoleIds<TRoleId extends string>(
  roles?: Array<TRoleId | RoleRef<TRoleId>>,
) {
  return roles?.map((role) => (typeof role === "string" ? role : role.id));
}

async function resolveMountedGroupTarget(
  auth: Pick<AuthApi, "group">,
  ctx: { auth: import("convex/server").Auth },
  target: MountedGroupTarget,
) {
  if (target.groupId !== undefined) {
    return {
      connectionId: target.connectionId,
      groupId: target.groupId,
      resolvedGroupId: target.groupId,
    };
  }

  if (target.connectionId !== undefined) {
    const connection = await auth.group.sso.connection.get(
      ctx as never,
      target.connectionId,
    );
    if (connection === null) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Connection not found.",
      });
    }
    return {
      connectionId: connection._id,
      groupId: connection.groupId,
      resolvedGroupId: connection.groupId,
    };
  }

  if (target.domain !== undefined) {
    const resolved = await auth.group.sso.connection.getByDomain(
      ctx as never,
      target.domain,
    );
    if (resolved?.connection === undefined) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Connection not found.",
      });
    }
    return {
      connectionId: resolved.connection._id,
      groupId: resolved.connection.groupId,
      resolvedGroupId: resolved.connection.groupId,
    };
  }

  return {
    connectionId: undefined,
    groupId: undefined,
    resolvedGroupId: null,
  };
}

function createMountedAdminAuthorizer(
  auth: Pick<AuthApi, "context" | "group">,
  options?: GroupMountOptions,
) {
  const requireUserId = requireSignedInUser(auth);

  return async (
    ctx: { auth: import("convex/server").Auth },
    permission: SsoAdminPermission,
    target: MountedGroupTarget = {},
  ) => {
    const userId = await requireUserId(ctx);
    if (userId === null) {
      throw Cv.error({
        code: "NOT_SIGNED_IN",
        message: "You must be signed in to perform this action.",
      });
    }
    if (!options?.admin?.authorized) {
      throw Cv.error({
        code: "FORBIDDEN",
        message: "Access denied.",
      });
    }
    const resolved = await resolveMountedGroupTarget(auth, ctx, target);
    await options.admin.authorized(ctx, {
      userId,
      permission,
      connectionId: resolved.connectionId,
      groupId: resolved.groupId,
      resolvedGroupId: resolved.resolvedGroupId,
    });
    return { userId, ...resolved };
  };
}

/**
 * Build optional public SSO management actions that apps can mount under
 * `convex/auth/sso/**` when they want client-callable group SSO APIs.
 *
 * `admin` is for tenant-admin control-plane operations and should be mounted
 * with an explicit authorization policy. `client` is for end-user sign-in
 * helpers and does not require tenant-admin authorization.
 *
 * @param auth - Auth API subset providing `group`, `member`, `sso`, and `user` namespaces.
 * @param options - Optional admin authorization config. See {@link GroupMountOptions}.
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
 * @see {@link group connection}
 */
export function sso<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  auth: Pick<AuthApi<TAuthorization>, "context" | "group" | "member">,
  options?: GroupMountOptions<AuthRoleId<TAuthorization>>,
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
            protocol: v.union(v.literal("oidc"), v.literal("saml")),
            status: v.optional(groupConnectionStatusValidator),
            domain: v.optional(v.string()),
          },
          handler: async (ctx, args) => {
            const authResult = await authorize(ctx, "sso.connection.create", {
              groupId: args.groupId,
            });
            const { userId } = authResult;
            const createsGroup = args.groupId === undefined;
            const groupId =
              args.groupId ??
              (
                await auth.group.create(ctx as never, {
                  name: args.name?.trim() || args.slug?.trim() || "Group Connection",
                  slug: args.slug,
                  type: "group connection",
                })
              ).groupId;
            if (createsGroup) {
              await auth.member.create(ctx as never, {
                groupId,
                userId,
                roleIds: adminRoleIds as AuthRoleId<TAuthorization>[] | undefined,
              });
            }
            const created = await auth.group.sso.connection.create(
              ctx as never,
              {
                groupId,
                name: args.name,
                slug: args.slug,
                protocol: args.protocol,
                status: args.status,
              },
            );
            if (args.domain) {
              await auth.group.sso.connection.domain.set(
                ctx as never,
                created.connectionId,
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
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.connection.get(
              ctx as never,
              args.connectionId,
            );
          },
        }),
        getByDomain: queryGeneric({
          args: { domain: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              domain: args.domain,
            });
            return await auth.group.sso.connection.getByDomain(
              ctx as never,
              args.domain,
            );
          },
        }),
        list: queryGeneric({
          args: {
            where: v.optional(groupConnectionWhereValidator),
            limit: v.optional(v.number()),
            cursor: v.optional(v.union(v.string(), v.null())),
            orderBy: v.optional(v.string()),
            order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
          },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              groupId: args.where?.groupId,
            });
            return await auth.group.sso.connection.list(
              ctx as never,
              args as never,
            );
          },
        }),
        update: mutationGeneric({
          args: {
            connectionId: v.string(),
            data: v.object({
              name: v.optional(v.string()),
              slug: v.optional(v.string()),
              status: v.optional(groupConnectionStatusValidator),
            }),
          },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.manage", {
              connectionId: args.connectionId,
            });
            await auth.group.sso.connection.update(
              ctx as never,
              args.connectionId,
              args.data,
            );
            return { connectionId: args.connectionId };
          },
        }),
        delete: mutationGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.connection.delete(
              ctx as never,
              args.connectionId,
            );
          },
        }),
        status: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.connection.status(
              ctx as never,
              args.connectionId,
            );
          },
        }),
        domain: {
          list: queryGeneric({
            args: { connectionId: v.string() },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.connection.read", {
                connectionId: args.connectionId,
              });
              return await auth.group.sso.connection.domain.list(
                ctx as never,
                args.connectionId,
              );
            },
          }),
          validate: queryGeneric({
            args: { connectionId: v.string() },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.domain.manage", {
                connectionId: args.connectionId,
              });
              return await auth.group.sso.connection.domain.validate(
                ctx as never,
                args.connectionId,
              );
            },
          }),
          set: mutationGeneric({
            args: {
              connectionId: v.string(),
              domains: v.array(groupConnectionDomainInputValidator),
            },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.domain.manage", {
                connectionId: args.connectionId,
              });
              return await auth.group.sso.connection.domain.set(
                ctx as never,
                args.connectionId,
                args.domains,
              );
            },
          }),
          verification: {
            request: mutationGeneric({
              args: groupConnectionDomainVerificationInputValidator,
              handler: async (ctx, args) => {
                await authorize(ctx, "sso.domain.manage", {
                  connectionId: args.connectionId,
                });
                return await auth.group.sso.connection.domain.verification.request(
                  ctx as never,
                  args,
                );
              },
            }),
            confirm: actionGeneric({
              args: groupConnectionDomainVerificationInputValidator,
              handler: async (ctx, args) => {
                await authorize(ctx, "sso.domain.manage", {
                  connectionId: args.connectionId,
                });
                return await auth.group.sso.connection.domain.verification.confirm(
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
            connectionId: v.string(),
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
            await authorize(ctx, "sso.protocol.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.oidc.configure(ctx as never, {
              ...args,
              connectionId: args.connectionId,
            });
          },
        }),
        get: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.oidc.get(
              ctx as never,
              args.connectionId,
            );
          },
        }),
        validate: actionGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.protocol.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.oidc.validate(
              ctx as never,
              args.connectionId,
            );
          },
        }),
      },
      saml: {
        configure: actionGeneric({
          args: {
            connectionId: v.string(),
            metadataXml: v.optional(v.string()),
            metadataUrl: v.optional(v.string()),
            domains: v.optional(v.array(v.string())),
            signAuthnRequests: v.optional(v.boolean()),
            attributeMapping: v.optional(
              ssoSamlAttributeMappingValidator,
            ),
            sp: v.optional(ssoSamlSpValidator),
          },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.protocol.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.saml.configure(ctx as never, {
              ...args,
              connectionId: args.connectionId,
            });
          },
        }),
        validate: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.protocol.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.saml.validate(
              ctx as never,
              args.connectionId,
            );
          },
        }),
      },
      policy: {
        get: queryGeneric({
          args: { groupId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.policy.manage", {
              groupId: args.groupId,
            });
            return await auth.group.sso.policy.get(
              ctx as never,
              args.groupId,
            );
          },
        }),
        update: mutationGeneric({
          args: {
            groupId: v.string(),
            patch: groupPolicyPatchValidator,
          },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.policy.manage", {
              groupId: args.groupId,
            });
            return await auth.group.sso.policy.update(
              ctx as never,
              args.groupId,
              args.patch,
            );
          },
        }),
        validate: queryGeneric({
          args: { groupId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.policy.manage", {
              groupId: args.groupId,
            });
            return await auth.group.sso.policy.validate(
              ctx as never,
              args.groupId,
            );
          },
        }),
      },
      audit: {
        list: queryGeneric({
          args: {
            groupId: v.optional(v.string()),
            connectionId: v.optional(v.string()),
            limit: v.optional(v.number()),
          },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.audit.read", {
              connectionId: args.connectionId,
              groupId: args.groupId,
            });
            return await auth.group.sso.audit.list(ctx as never, args);
          },
        }),
      },
      webhook: {
        delivery: {
          list: queryGeneric({
            args: {
              connectionId: v.string(),
              limit: v.optional(v.number()),
            },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.webhook.manage", {
                connectionId: args.connectionId,
              });
              return await (auth.group.sso.webhook as any).delivery.list(
                ctx as never,
                args,
              );
            },
          }),
        },
        endpoint: {
          create: mutationGeneric({
            args: {
              connectionId: v.string(),
              url: v.string(),
              secret: v.string(),
              subscriptions: v.array(v.string()),
              createdByUserId: v.optional(v.string()),
            },
            handler: async (ctx, args) => {
              const authResult = await authorize(ctx, "sso.webhook.manage", {
                connectionId: args.connectionId,
              });
              const { userId } = authResult;
              const result = await auth.group.sso.webhook.endpoint.create(
                ctx as never,
                {
                  ...args,
                  createdByUserId: args.createdByUserId ?? userId,
                },
              );
              return {
                _id: result.endpointId,
                connectionId: args.connectionId,
                url: args.url,
                subscriptions: args.subscriptions,
                createdByUserId: args.createdByUserId ?? userId,
                status: "active",
                failureCount: 0,
              };
            },
          }),
          list: queryGeneric({
            args: { connectionId: v.string() },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.webhook.manage", {
                connectionId: args.connectionId,
              });
              const endpoints = await auth.group.sso.webhook.endpoint.list(
                ctx as never,
                args.connectionId,
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
              const endpoint = await auth.group.sso.webhook.endpoint.get(
                ctx as never,
                args.endpointId,
              );
              if (!endpoint) {
                throw Cv.error({
                  code: "INVALID_PARAMETERS",
                  message: "Webhook endpoint not found.",
                });
              }
              await authorize(ctx, "sso.webhook.manage", {
                connectionId: endpoint.connectionId,
                groupId: endpoint.groupId,
              });
              return await auth.group.sso.webhook.endpoint.disable(
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
          connectionId: v.optional(v.string()),
          email: v.optional(v.string()),
          domain: v.optional(v.string()),
          redirectTo: v.optional(v.string()),
        },
        handler: async (ctx, args) => {
          return await auth.group.sso.signIn(ctx as never, {
            ...args,
            connectionId: args.connectionId,
          });
        },
      }),
      metadata: queryGeneric({
        args: {
          connectionId: v.string(),
          entityId: v.optional(v.string()),
          acsUrl: v.optional(v.string()),
          sloUrl: v.optional(v.string()),
        },
        handler: async (ctx, args) => {
          return await auth.group.sso.metadata(ctx as never, {
            ...args,
            connectionId: args.connectionId,
          });
        },
      }),
    },
  };
}

/**
 * Build optional public SCIM management actions that apps can mount under
 * `convex/auth/group/**` when they want client-callable group SSO admin APIs.
 *
 * @param auth - Auth API subset providing `group` and `context` namespaces.
 * @param options - Optional admin authorization config. See {@link GroupMountOptions}.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @returns An object with `admin.configure`, `admin.get`, and `admin.validate` actions.
 *
 * @example
 * ```ts
 * // convex/auth/group.ts
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
 * @see {@link group connection}
 */
export function scim<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  auth: Pick<AuthApi<TAuthorization>, "context" | "group">,
  options?: GroupMountOptions<AuthRoleId<TAuthorization>>,
) {
  const authorize = createMountedAdminAuthorizer(auth, options);

  return {
    admin: {
      configure: mutationGeneric({
        args: {
          connectionId: v.string(),
          basePath: v.optional(v.string()),
          status: v.optional(groupConnectionStatusValidator),
        },
        handler: async (ctx, args) => {
          await authorize(ctx, "scim.manage", {
            connectionId: args.connectionId,
          });
          return await auth.group.sso.scim.configure(ctx as never, {
            ...args,
            connectionId: args.connectionId,
          });
        },
      }),
      get: queryGeneric({
        args: { connectionId: v.string() },
        handler: async (ctx, args) => {
          await authorize(ctx, "scim.manage", {
            connectionId: args.connectionId,
          });
          return await auth.group.sso.scim.get(ctx as never, args.connectionId);
        },
      }),
      validate: queryGeneric({
        args: { connectionId: v.string() },
        handler: async (ctx, args) => {
          await authorize(ctx, "scim.manage", {
            connectionId: args.connectionId,
          });
          return await auth.group.sso.scim.validate(
            ctx as never,
            args.connectionId,
          );
        },
      }),
    },
  };
}

/**
 * Build a flat mounted group SSO API surface for app-owned Convex exports.
 *
 * Combines {@link sso} and {@link scim} into a single flat object with
 * all SSO connection, protocol, policy, audit, webhook, and SCIM
 * management functions plus end-user sign-in helpers. The `authorized`
 * callback is required for all admin operations.
 *
 * @param auth - Auth API subset providing `group`, `member`, and `context` namespaces.
 * @param options - Required {@link GroupMountOptions} with an `admin.authorized` callback.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @returns A flat object with all group connection management functions (e.g. `createConnection`,
 *   `configureOidc`, `configureScim`, `signIn`, etc.).
 *
 * @example
 * ```ts
 * // convex/auth/group.ts
 * import { group connection } from "@robelest/convex-auth/server";
 * import { auth } from "../auth";
 *
 * const api = group(auth, {
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
export function group<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  auth: Pick<AuthApi<TAuthorization>, "context" | "group" | "member">,
  options: GroupMountOptions<AuthRoleId<TAuthorization>>,
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
