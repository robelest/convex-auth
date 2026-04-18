import {
  actionGeneric,
  mutationGeneric,
  queryGeneric,
  type GenericActionCtx,
  type GenericDataModel,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import type { AuthApi } from "./auth";
import {
  groupConnectionWhereValidator,
  groupConnectionDomainInputValidator,
  groupConnectionDomainVerificationInputValidator,
  groupPolicyPatchValidator,
  ssoSamlAttributeMappingValidator,
  ssoSamlSecurityValidator,
  ssoSamlSpValidator,
  groupConnectionStatusValidator,
} from "./sso/validators";
import type { AuthAuthorizationConfig } from "./types";

type MountConnection = { _id: string; groupId: string };
type DeliveryApi = {
  delivery: {
    list: (
      ctx: GenericActionCtx<GenericDataModel>,
      args: { connectionId: string; limit?: number },
    ) => Promise<unknown>;
  };
};

/**
 * Permission identifiers used by mounted group SSO admin APIs.
 *
 * These permission strings are passed to your {@link GroupSsoAccessHandler}
 * callback so app code can decide whether the current user may perform a
 * specific SSO or SCIM management operation.
 *
 * @example
 * ```ts
 * const access: GroupSsoAccessHandler = async (ctx, input) => {
 *   if (input.permission === "sso.connection.create") {
 *     // Only org admins may create SSO connections
 *   }
 * };
 * ```
 */
export type GroupSsoPermission =
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
 * Input passed to a mounted Group SSO access check.
 *
 * Contains the acting user, the requested permission, and the resolved
 * group connection/group scope for the operation being authorized.
 */
export type GroupSsoAccessInput = {
  /** The signed-in user's ID performing the admin action. */
  userId: string;
  /** The {@link GroupSsoPermission} being requested. */
  permission: GroupSsoPermission;
  /** Connection document ID, if the operation targets a specific SSO connection. */
  connectionId?: string;
  /** Resolved group document ID, when the operation has group scope. */
  groupId?: string;
};

/**
 * App-defined access hook for mounted group SSO admin APIs.
 *
 * Return `void` (or resolve) to allow the operation, or throw to deny it.
 *
 * @param ctx - Convex context with `ctx.auth` for identity checks.
 * @param input - The {@link GroupSsoAccessInput} describing who is doing what.
 * @returns `void` to allow; throw to deny.
 *
 * @example
 * ```ts
 * import { GroupSsoAccessHandler } from "@robelest/convex-auth/server";
 *
 * const access: GroupSsoAccessHandler = async (ctx, input) => {
 *   const identity = await ctx.auth.getUserIdentity();
 *   if (!identity) throw new Error("Forbidden");
 *   // Allow all admin ops for the org owner
 * };
 * ```
 */
export type GroupSsoAccessHandler = (
  ctx: { auth: import("convex/server").Auth },
  input: GroupSsoAccessInput,
) => Promise<void>;

/**
 * Declarative requirement map for mounted Group SSO admin permissions.
 *
 * Use `require` at any subtree to define the default requirements for all
 * descendant operations. Child entries override that inherited default when
 * present. This lets apps describe coarse defaults with narrower overrides for
 * specific admin operations.
 *
 * @typeParam TRequirement - App-defined requirement values passed back to
 *   {@link GroupSsoResolvedAccessHandler}. These can be role refs, grant
 *   strings, or any other policy tokens your app understands.
 *
 * @example
 * ```ts
 * const permissions: GroupSsoAccessPermissions<string> = {
 *   sso: {
 *     require: ["workspace.sso.read"],
 *     connection: {
 *       create: ["workspace.sso.manage"],
 *       manage: ["workspace.sso.manage"],
 *     },
 *   },
 *   scim: {
 *     require: ["workspace.scim.manage"],
 *   },
 * };
 * ```
 */
export type GroupSsoAccessPermissions<TRequirement> = {
  sso?: {
    require?: readonly TRequirement[];
    connection?: {
      create?: readonly TRequirement[];
      read?: readonly TRequirement[];
      manage?: readonly TRequirement[];
    };
    domain?: {
      manage?: readonly TRequirement[];
    };
    protocol?: {
      manage?: readonly TRequirement[];
    };
    policy?: {
      manage?: readonly TRequirement[];
    };
    audit?: {
      read?: readonly TRequirement[];
    };
    webhook?: {
      manage?: readonly TRequirement[];
    };
  };
  scim?: {
    require?: readonly TRequirement[];
    manage?: readonly TRequirement[];
  };
};

/**
 * App-defined access hook for declarative mounted Group SSO permissions.
 *
 * The mounted API resolves the requirements for the current
 * {@link GroupSsoPermission} from {@link GroupSsoAccessPermissions} and passes
 * them to this callback. Throw to deny the operation, or resolve to allow it.
 *
 * @typeParam TRequirement - App-defined requirement values resolved from the
 *   configured permission tree.
 * @param ctx - Convex context with `ctx.auth` for identity checks.
 * @param input - The normalized mounted access input.
 * @param required - The resolved requirement values for the current operation.
 * @returns `void` to allow; throw to deny.
 *
 * @example
 * ```ts
 * const access: GroupSsoResolvedAccessHandler<string> = async (
 *   ctx,
 *   input,
 *   required,
 * ) => {
 *   if (!input.groupId) {
 *     throw new Error("Group scope required");
 *   }
 *
 *   await auth.member.require(ctx, {
 *     userId: input.userId,
 *     groupId: input.groupId,
 *     grants: [...required],
 *   });
 * };
 * ```
 */
export type GroupSsoResolvedAccessHandler<TRequirement> = (
  ctx: { auth: import("convex/server").Auth },
  input: GroupSsoAccessInput,
  required: readonly TRequirement[],
) => Promise<void>;

/**
 * Configuration for {@link createAuthGroupSso}, {@link sso}, and {@link scim}
 * mounted admin APIs.
 *
 * @example
 * ```ts
 * import { createAuthGroupSso, CreateAuthGroupSsoOptions } from "@robelest/convex-auth/server";
 *
 * const options: CreateAuthGroupSsoOptions<string> = {
 *   permissions: {
 *     sso: { require: ["workspace.sso.manage"] },
 *     scim: { require: ["workspace.scim.manage"] },
 *   },
 *   access: async (_ctx, _input, _required) => {
 *     // Verify the current user satisfies the resolved requirements.
 *   },
 * };
 * ```
 */
export type CreateAuthGroupSsoOptions<TRequirement = unknown> =
  | {
      access: GroupSsoAccessHandler;
      permissions?: undefined;
    }
  | {
      permissions: GroupSsoAccessPermissions<TRequirement>;
      access: GroupSsoResolvedAccessHandler<TRequirement>;
    };

type MountedGroupTarget = {
  connectionId?: string;
  groupId?: string;
  domain?: string;
};

function requireSignedInUser(auth: Pick<AuthApi, "context">) {
  return async (ctx: { auth: import("convex/server").Auth }): Promise<string | null> => {
    return (await auth.context(ctx, { optional: true })).userId;
  };
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
    };
  }

  if (target.connectionId !== undefined) {
    const connection = (await auth.group.sso.connection.get(
      ctx as never,
      target.connectionId,
    )) as MountConnection | null;
    if (connection === null) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Connection not found.",
      });
    }
    return {
      connectionId: connection._id,
      groupId: connection.groupId,
    };
  }

  if (target.domain !== undefined) {
    const resolved = await auth.group.sso.connection.getByDomain(ctx as never, target.domain);
    if (resolved?.connection == null) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Connection not found.",
      });
    }
    return {
      connectionId: resolved.connection._id,
      groupId: resolved.connection.groupId,
    };
  }

  return {
    connectionId: undefined,
    groupId: undefined,
  };
}

function resolveRequiredAccess<TRequirement>(
  permissions: GroupSsoAccessPermissions<TRequirement>,
  permission: GroupSsoPermission,
): readonly TRequirement[] | undefined {
  const ssoRequire = permissions.sso?.require;
  const scimRequire = permissions.scim?.require;
  switch (permission) {
    case "sso.connection.create":
      return permissions.sso?.connection?.create ?? ssoRequire;
    case "sso.connection.read":
      return permissions.sso?.connection?.read ?? ssoRequire;
    case "sso.connection.manage":
      return permissions.sso?.connection?.manage ?? ssoRequire;
    case "sso.domain.manage":
      return permissions.sso?.domain?.manage ?? ssoRequire;
    case "sso.protocol.manage":
      return permissions.sso?.protocol?.manage ?? ssoRequire;
    case "sso.policy.manage":
      return permissions.sso?.policy?.manage ?? ssoRequire;
    case "sso.audit.read":
      return permissions.sso?.audit?.read ?? ssoRequire;
    case "sso.webhook.manage":
      return permissions.sso?.webhook?.manage ?? ssoRequire;
    case "scim.manage":
      return permissions.scim?.manage ?? scimRequire;
  }
}

function createMountedAdminAuthorizer<TRequirement>(
  auth: Pick<AuthApi, "context" | "group">,
  options?: CreateAuthGroupSsoOptions<TRequirement>,
) {
  const requireUserId = requireSignedInUser(auth);

  return async (
    ctx: { auth: import("convex/server").Auth },
    permission: GroupSsoPermission,
    target: MountedGroupTarget = {},
  ) => {
    const userId = await requireUserId(ctx);
    if (userId === null) {
      throw new ConvexError({
        code: "NOT_SIGNED_IN",
        message: "You must be signed in to perform this action.",
      });
    }
    if (!options) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Access denied.",
      });
    }
    const resolved = await resolveMountedGroupTarget(auth, ctx, target);
    const input = {
      userId,
      permission,
      connectionId: resolved.connectionId,
      groupId: resolved.groupId,
    } satisfies GroupSsoAccessInput;
    if (options.permissions === undefined) {
      await options.access(ctx, input);
      return { userId, ...resolved };
    }
    const required = resolveRequiredAccess(options.permissions, permission);
    if (required === undefined) {
      throw new Error(`Missing permissions entry for mounted Group SSO permission: ${permission}`);
    }
    await options.access(ctx, input, required);
    return { userId, ...resolved };
  };
}

/**
 * Build optional public SSO management actions that apps can mount under
 * `convex/auth/sso/**` when they want client-callable group SSO APIs.
 *
 * `admin` is for tenant-admin control-plane operations and should be mounted
 * with an explicit access policy. `client` is for end-user sign-in
 * helpers and does not require tenant-admin authorization.
 *
 * @param auth - Auth API subset providing `group`, `member`, `sso`, and `user` namespaces.
 * @param options - Optional admin access config. See {@link CreateAuthGroupSsoOptions}.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @typeParam TRequirement - App-defined requirement values used by declarative
 *   `permissions` configs.
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
 *   permissions: {
 *     sso: { require: ["workspace.sso.manage"] },
 *   },
 *   access: async (_ctx, _input, _required) => {},
 * });
 *
 * export const createConnection = mounted.admin.connection.create;
 * export const signIn = mounted.client.signIn;
 * ```
 *
 * @see {@link scim}
 * @see {@link createAuthGroupSso}
 */
export function sso<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
  TRequirement = unknown,
>(
  auth: Pick<AuthApi<TAuthorization>, "context" | "group" | "member">,
  options?: CreateAuthGroupSsoOptions<TRequirement>,
) {
  const authorize = createMountedAdminAuthorizer(auth, options);

  return {
    admin: {
      connection: {
        create: mutationGeneric({
          args: {
            groupId: v.string(),
            name: v.optional(v.string()),
            slug: v.optional(v.string()),
            protocol: v.union(v.literal("oidc"), v.literal("saml")),
            status: v.optional(groupConnectionStatusValidator),
            domain: v.optional(v.string()),
          },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.create", {
              groupId: args.groupId,
            });
            const created = await auth.group.sso.connection.create(ctx as never, {
              groupId: args.groupId,
              name: args.name,
              slug: args.slug,
              protocol: args.protocol,
              status: args.status,
            });
            if (args.domain) {
              await auth.group.sso.connection.domain.set(ctx as never, created.connectionId, [
                { domain: args.domain, isPrimary: true },
              ]);
            }
            return {
              ...created,
              groupId: args.groupId,
            };
          },
        }),
        get: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.connection.get(ctx as never, args.connectionId);
          },
        }),
        getByDomain: queryGeneric({
          args: { domain: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              domain: args.domain,
            });
            return await auth.group.sso.connection.getByDomain(ctx as never, args.domain);
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
            return await auth.group.sso.connection.list(ctx as never, args as never);
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
            await auth.group.sso.connection.update(ctx as never, args.connectionId, args.data);
            return { connectionId: args.connectionId };
          },
        }),
        delete: mutationGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.connection.delete(ctx as never, args.connectionId);
          },
        }),
        status: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.connection.status(ctx as never, args.connectionId);
          },
        }),
        domain: {
          list: queryGeneric({
            args: { connectionId: v.string() },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.connection.read", {
                connectionId: args.connectionId,
              });
              return await auth.group.sso.connection.domain.list(ctx as never, args.connectionId);
            },
          }),
          status: queryGeneric({
            args: { connectionId: v.string() },
            handler: async (ctx, args) => {
              await authorize(ctx, "sso.domain.manage", {
                connectionId: args.connectionId,
              });
              return await auth.group.sso.connection.domain.status(ctx as never, args.connectionId);
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
            discovery: v.object({
              issuer: v.optional(v.string()),
              discoveryUrl: v.optional(v.string()),
              jwksUri: v.optional(v.string()),
              audience: v.optional(v.union(v.string(), v.array(v.string()))),
            }),
            client: v.object({
              id: v.string(),
              secret: v.optional(v.string()),
              authMethod: v.optional(
                v.union(v.literal("client_secret_post"), v.literal("client_secret_basic")),
              ),
            }),
            request: v.optional(
              v.object({
                scopes: v.optional(v.array(v.string())),
                loginHint: v.optional(v.string()),
                authorizationParams: v.optional(v.record(v.string(), v.string())),
              }),
            ),
            security: v.optional(
              v.object({
                clockToleranceSeconds: v.optional(v.number()),
                strictIssuer: v.optional(v.boolean()),
              }),
            ),
            profile: v.optional(
              v.object({
                mapping: v.optional(
                  v.object({
                    subject: v.optional(v.string()),
                    email: v.optional(v.string()),
                    emailVerified: v.optional(v.string()),
                    name: v.optional(v.string()),
                    image: v.optional(v.string()),
                    groups: v.optional(v.string()),
                    roles: v.optional(v.string()),
                  }),
                ),
                extraFields: v.optional(v.record(v.string(), v.string())),
              }),
            ),
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
            return await auth.group.sso.oidc.get(ctx as never, args.connectionId);
          },
        }),
        validate: actionGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.protocol.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.oidc.validate(ctx as never, args.connectionId);
          },
        }),
        status: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.oidc.status(ctx as never, args.connectionId);
          },
        }),
      },
      saml: {
        configure: actionGeneric({
          args: {
            connectionId: v.string(),
            metadata: v.object({
              xml: v.optional(v.string()),
              url: v.optional(v.string()),
            }),
            domains: v.optional(v.array(v.string())),
            request: v.optional(
              v.object({
                signAuthnRequests: v.optional(v.boolean()),
                nameIdFormat: v.optional(v.string()),
                forceAuthn: v.optional(v.boolean()),
                authnContextClassRefs: v.optional(v.array(v.string())),
              }),
            ),
            profile: v.optional(
              v.object({
                mapping: v.optional(ssoSamlAttributeMappingValidator),
                extraFields: v.optional(v.record(v.string(), v.string())),
              }),
            ),
            security: v.optional(ssoSamlSecurityValidator),
            serviceProvider: v.optional(ssoSamlSpValidator),
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
            return await auth.group.sso.saml.validate(ctx as never, args.connectionId);
          },
        }),
        get: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.saml.get(ctx as never, args.connectionId);
          },
        }),
        status: queryGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.connection.read", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.saml.status(ctx as never, args.connectionId);
          },
        }),
        refresh: actionGeneric({
          args: { connectionId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.protocol.manage", {
              connectionId: args.connectionId,
            });
            return await auth.group.sso.saml.refresh(ctx as never, args);
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
            return await auth.group.sso.policy.get(ctx as never, args.groupId);
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
            return await auth.group.sso.policy.update(ctx as never, args.groupId, args.patch);
          },
        }),
        validate: queryGeneric({
          args: { groupId: v.string() },
          handler: async (ctx, args) => {
            await authorize(ctx, "sso.policy.manage", {
              groupId: args.groupId,
            });
            return await auth.group.sso.policy.validate(ctx as never, args.groupId);
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
              const deliveryApi = auth.group.sso.webhook as unknown as {
                delivery: DeliveryApi["delivery"];
              };
              return await deliveryApi.delivery.list(ctx as never, args);
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
              const result = await auth.group.sso.webhook.endpoint.create(ctx as never, {
                ...args,
                createdByUserId: args.createdByUserId ?? userId,
              });
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
                throw new ConvexError({
                  code: "INVALID_PARAMETERS",
                  message: "Webhook endpoint not found.",
                });
              }
              await authorize(ctx, "sso.webhook.manage", {
                connectionId: endpoint.connectionId,
                groupId: endpoint.groupId,
              });
              return await auth.group.sso.webhook.endpoint.disable(ctx as never, args.endpointId);
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
          loginHint: v.optional(v.string()),
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
 * @param options - Optional admin access config. See {@link CreateAuthGroupSsoOptions}.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @typeParam TRequirement - App-defined requirement values used by declarative
 *   `permissions` configs.
 * @returns An object with `admin.configure`, `admin.get`, and `admin.validate` actions.
 *
 * @example
 * ```ts
 * // convex/auth/group.ts
 * import { scim } from "@robelest/convex-auth/server";
 * import { auth } from "../auth";
 *
 * const mounted = scim(auth, {
 *   permissions: {
 *     scim: { require: ["workspace.scim.manage"] },
 *   },
 *   access: async (_ctx, _input, _required) => {},
 * });
 *
 * export const configure = mounted.admin.configure;
 * export const get = mounted.admin.get;
 * export const validate = mounted.admin.validate;
 * ```
 *
 * @see {@link sso}
 * @see {@link createAuthGroupSso}
 */
export function scim<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
  TRequirement = unknown,
>(
  auth: Pick<AuthApi<TAuthorization>, "context" | "group">,
  options?: CreateAuthGroupSsoOptions<TRequirement>,
) {
  const authorize = createMountedAdminAuthorizer(auth, options);

  return {
    admin: {
      configure: mutationGeneric({
        args: {
          connectionId: v.string(),
          status: v.optional(groupConnectionStatusValidator),
          security: v.optional(
            v.object({
              maxRequestSize: v.optional(v.number()),
            }),
          ),
          profile: v.optional(
            v.object({
              mapping: v.optional(
                v.object({
                  subject: v.optional(v.string()),
                  externalId: v.optional(v.string()),
                  email: v.optional(v.string()),
                  firstName: v.optional(v.string()),
                  lastName: v.optional(v.string()),
                  name: v.optional(v.string()),
                  phone: v.optional(v.string()),
                  active: v.optional(v.string()),
                  groups: v.optional(v.string()),
                  roles: v.optional(v.string()),
                }),
              ),
              extraFields: v.optional(v.record(v.string(), v.string())),
            }),
          ),
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
      status: queryGeneric({
        args: { connectionId: v.string() },
        handler: async (ctx, args) => {
          await authorize(ctx, "scim.manage", {
            connectionId: args.connectionId,
          });
          return await auth.group.sso.scim.status(ctx as never, args.connectionId);
        },
      }),
      validate: queryGeneric({
        args: { connectionId: v.string() },
        handler: async (ctx, args) => {
          await authorize(ctx, "scim.manage", {
            connectionId: args.connectionId,
          });
          return await auth.group.sso.scim.validate(ctx as never, args.connectionId);
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
 * management functions plus end-user sign-in helpers. The `access`
 * config is required for all admin operations.
 *
 * @param auth - Auth API subset providing `group`, `member`, and `context` namespaces.
 * @param options - Required {@link CreateAuthGroupSsoOptions} with an `access` policy.
 * @typeParam TAuthorization - Optional authorization config for typed role IDs.
 * @typeParam TRequirement - App-defined requirement values used by declarative
 *   `permissions` configs.
 * @returns A flat object with all group connection management functions (e.g. `createConnection`,
 *   `configureOidc`, `configureScim`, `signIn`, etc.).
 *
 * @example
 * ```ts
 * // convex/auth/group.ts
 * import { createAuthGroupSso } from "@robelest/convex-auth/server";
 * import { auth } from "../auth";
 *
 * const api = createAuthGroupSso(auth, {
 *   permissions: {
 *     sso: { require: ["workspace.sso.manage"] },
 *     scim: { require: ["workspace.scim.manage"] },
 *   },
 *   access: async (_ctx, _input, _required) => {},
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
export function createAuthGroupSso<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
  TRequirement = unknown,
>(
  auth: Pick<AuthApi<TAuthorization>, "context" | "group" | "member">,
  options: CreateAuthGroupSsoOptions<TRequirement>,
) {
  const mountedSso = sso(auth, options);
  const mountedScim = scim(auth, options);

  return {
    createConnection: mountedSso.admin.connection.create,
    getConnection: mountedSso.admin.connection.get,
    getConnectionByDomain: mountedSso.admin.connection.getByDomain,
    listConnections: mountedSso.admin.connection.list,
    updateConnection: mountedSso.admin.connection.update,
    deleteConnection: mountedSso.admin.connection.delete,
    getConnectionStatus: mountedSso.admin.connection.status,
    listDomains: mountedSso.admin.connection.domain.list,
    getDomainStatus: mountedSso.admin.connection.domain.status,
    validateDomains: mountedSso.admin.connection.domain.validate,
    setDomains: mountedSso.admin.connection.domain.set,
    requestDomainVerification: mountedSso.admin.connection.domain.verification.request,
    confirmDomainVerification: mountedSso.admin.connection.domain.verification.confirm,
    configureOidc: mountedSso.admin.oidc.configure,
    getOidc: mountedSso.admin.oidc.get,
    getOidcStatus: mountedSso.admin.oidc.status,
    validateOidc: mountedSso.admin.oidc.validate,
    configureSaml: mountedSso.admin.saml.configure,
    getSaml: mountedSso.admin.saml.get,
    getSamlStatus: mountedSso.admin.saml.status,
    validateSaml: mountedSso.admin.saml.validate,
    refreshSaml: mountedSso.admin.saml.refresh,
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
    getScimStatus: mountedScim.admin.status,
    validateScim: mountedScim.admin.validate,
    signIn: mountedSso.client.signIn,
    metadata: mountedSso.client.metadata,
  };
}
