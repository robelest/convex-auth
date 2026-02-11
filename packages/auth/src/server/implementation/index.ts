import { OAuth2Config, OAuthConfig } from "@auth/core/providers";
import {
  Auth,
  DocumentByName,
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  WithoutSystemFields,
  actionGeneric,
  httpActionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { ConvexError, GenericId, Value, v } from "convex/values";
import { parse as parseCookies, serialize as serializeCookie } from "cookie";
import { redirectToParamCookie, useRedirectToParam } from "../cookies.js";
import { FunctionReferenceFromExport, GenericDoc } from "../convex_types.js";
import {
  configDefaults,
  listAvailableProviders,
  materializeProvider,
} from "../provider_utils.js";
import {
  AuthProviderConfig,
  ConvexAuthConfig,
  GenericActionCtxWithAuthConfig,
} from "../types.js";
import { requireEnv } from "../utils.js";
import { ActionCtx, MutationCtx, Tokens } from "./types.js";
export { Doc, Tokens } from "./types.js";
import {
  LOG_LEVELS,
  TOKEN_SUB_CLAIM_DIVIDER,
  logError,
  logWithLevel,
} from "./utils.js";
import { GetProviderOrThrowFunc } from "./provider.js";
import {
  callCreateAccountFromCredentials,
  callInvalidateSessions,
  callModifyAccount,
  callRetreiveAccountWithCredentials,
  callSignOut,
  callUserOAuth,
  callVerifierSignature,
  storeArgs,
  storeImpl,
} from "./mutations/index.js";
import { signInImpl } from "./signIn.js";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects.js";
import { getAuthorizationUrl } from "../oauth/authorizationUrl.js";
import {
  defaultCookiesOptions,
  oAuthConfigToInternalProvider,
} from "../oauth/convexAuth.js";
import { handleOAuth } from "../oauth/callback.js";
export { getAuthSessionId } from "./sessions.js";

/**
 * The type of the signIn Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 */
export type SignInAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signIn"]
>;
/**
 * The type of the signOut Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 */
export type SignOutAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signOut"]
>;
/**
 * Configure the Convex Auth library. Returns an object with
 * functions and `auth` helper. You must export the functions
 * from `convex/auth.ts` to make them callable:
 *
 * ```ts filename="convex/auth.ts"
 * import { Auth } from "@robelest/convex-auth/component";
 *
 * export const { auth, signIn, signOut, store } = Auth({
 *   providers: [],
 * });
 * ```
 *
 * @returns An object with fields you should reexport from your
 *          `convex/auth.ts` file.
 */
export function Auth(config_: ConvexAuthConfig) {
  const config = configDefaults(config_ as any);
  const hasOAuth = config.providers.some(
    (provider) => provider.type === "oauth" || provider.type === "oidc",
  );
  const getProvider = (id: string, allowExtraProviders: boolean = false) => {
    return (
      config.providers.find((provider) => provider.id === id) ??
      (allowExtraProviders
        ? config.extraProviders.find((provider) => provider.id === id)
        : undefined)
    );
  };
  const getProviderOrThrow: GetProviderOrThrowFunc = (
    id: string,
    allowExtraProviders: boolean = false,
  ) => {
    const provider = getProvider(id, allowExtraProviders);
    if (provider === undefined) {
      const message =
        `Provider \`${id}\` is not configured, ` +
        `available providers are ${listAvailableProviders(config, allowExtraProviders)}.`;
      logWithLevel(LOG_LEVELS.ERROR, message);
      throw new Error(message);
    }
    return provider;
  };
  const enrichCtx = <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => ({ ...ctx, auth: { ...ctx.auth, config } });
  const requireComponent = () => {
    if (config.component === undefined) {
      throw new Error(
        "Auth component is not configured. Pass `component: components.auth` in Auth config.",
      );
    }
    return config.component;
  };
  type ComponentCtx = Pick<
    GenericActionCtx<GenericDataModel>,
    "runQuery" | "runMutation"
  >;
  type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
  type ComponentAuthReadCtx = ComponentReadCtx & { auth: Auth };

  const auth = {
    user: {
      /**
       * Get the current user's ID from the auth context, or `null` if
       * not signed in.
       */
      current: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          return null;
        }
        const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return userId as GenericId<"user">;
      },
      /**
       * Get the current user's ID, or throw if not signed in.
       * Use this when authentication is required.
       */
      require: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          throw new Error("Not signed in");
        }
        const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return userId as GenericId<"user">;
      },
      /**
       * Retrieve a user document by their ID.
       */
      get: async (ctx: ComponentReadCtx, userId: string) => {
        const component = requireComponent();
        return await ctx.runQuery(component.public.userGetById, { userId });
      },
      /**
       * Get the currently signed-in user's document, or `null` if not
       * signed in. Convenience method combining `current` + `get`.
       */
      viewer: async (ctx: ComponentAuthReadCtx) => {
        const userId = await auth.user.current(ctx);
        if (userId === null) {
          return null;
        }
        const component = requireComponent();
        return await ctx.runQuery(component.public.userGetById, { userId });
      },
      /**
       * Query a user's group memberships.
       */
      group: {
        /**
         * List all groups a user belongs to. Returns member records which
         * include the `groupId`, `role`, `status`, and `extend` for each.
         */
        list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
          const component = requireComponent();
          return await ctx.runQuery(component.public.memberListByUser, opts);
        },
        /**
         * Look up a user's membership in a specific group. Returns the member
         * record (with role, status, extend) or `null` if the user is not
         * a member.
         */
        get: async (
          ctx: ComponentReadCtx,
          opts: { userId: string; groupId: string },
        ) => {
          const component = requireComponent();
          return await ctx.runQuery(
            component.public.memberGetByGroupAndUser,
            opts,
          );
        },
      },
    },
    /**
     * Hierarchical group management. Groups can nest arbitrarily deep
     * via `parentGroupId`. A root group has no parent.
     *
     * ```ts
     * const groupId = await auth.group.create(ctx, { name: "Acme Corp" });
     * const subGroupId = await auth.group.create(ctx, {
     *   name: "Engineering",
     *   parentGroupId: groupId,
     * });
     * ```
     */
    group: {
      /**
       * Create a new group. Omit `parentGroupId` for a root-level group,
       * or provide it to create a nested group.
       *
       * @returns The ID of the newly created group.
       */
      create: async (
        ctx: ComponentCtx,
        data: {
          name: string;
          slug?: string;
          parentGroupId?: string;
          extend?: Record<string, unknown>;
        },
      ): Promise<string> => {
        const component = requireComponent();
        return (await ctx.runMutation(
          component.public.groupCreate,
          data,
        )) as string;
      },
      /**
       * Retrieve a group by its ID. Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, groupId: string) => {
        const component = requireComponent();
        return await ctx.runQuery(component.public.groupGet, { groupId });
      },
      /**
       * List groups. When `parentGroupId` is provided, returns children of
       * that group. When omitted, returns root-level groups (no parent).
       */
      list: async (ctx: ComponentReadCtx, opts?: { parentGroupId?: string }) => {
        const component = requireComponent();
        return await ctx.runQuery(component.public.groupList, {
          parentGroupId: opts?.parentGroupId,
        });
      },
      /**
       * Update a group's fields (name, slug, extend, parentGroupId).
       */
      update: async (
        ctx: ComponentCtx,
        groupId: string,
        data: Record<string, unknown>,
      ) => {
        const component = requireComponent();
        await ctx.runMutation(component.public.groupUpdate, { groupId, data });
      },
      /**
       * Delete a group and cascade to all descendants. Deletes child groups
       * (recursively), all members, and all invites for this group and its
       * descendants.
       */
      delete: async (ctx: ComponentCtx, groupId: string) => {
        const component = requireComponent();
        await ctx.runMutation(component.public.groupDelete, { groupId });
      },

      /**
       * Manage group membership. A member links a user to a group with an
       * application-defined role string (e.g. "owner", "admin", "member").
       *
       * The auth component stores roles but does not enforce access control.
       * Your application defines what each role means.
       */
      member: {
        /**
         * Add a user as a member of a group.
         *
         * @param data.groupId - The group to add the member to.
         * @param data.userId - The user to add.
         * @param data.role - Application-defined role (e.g. "owner", "admin", "member").
         * @param data.status - Optional membership status (e.g. "active", "suspended").
         * @param data.extend - Optional arbitrary JSON extension data.
         * @returns The ID of the new member record.
         */
        add: async (
          ctx: ComponentCtx,
          data: {
            groupId: string;
            userId: string;
            role?: string;
            status?: string;
            extend?: Record<string, unknown>;
          },
        ): Promise<string> => {
          const component = requireComponent();
          return (await ctx.runMutation(
            component.public.memberAdd,
            data,
          )) as string;
        },
        /**
         * Retrieve a member record by its ID. Returns `null` if not found.
         */
        get: async (ctx: ComponentReadCtx, memberId: string) => {
          const component = requireComponent();
          return await ctx.runQuery(component.public.memberGet, { memberId });
        },
        /**
         * List all members of a group.
         */
        list: async (ctx: ComponentReadCtx, opts: { groupId: string }) => {
          const component = requireComponent();
          return await ctx.runQuery(component.public.memberList, opts);
        },
        /**
         * Remove a member from a group by deleting the member record.
         */
        remove: async (ctx: ComponentCtx, memberId: string) => {
          const component = requireComponent();
          await ctx.runMutation(component.public.memberRemove, { memberId });
        },
        /**
         * Update a member's fields (role, status, extend).
         *
         * ```ts
         * await auth.group.member.update(ctx, memberId, { role: "admin" });
         * ```
         */
        update: async (
          ctx: ComponentCtx,
          memberId: string,
          data: Record<string, unknown>,
        ) => {
          const component = requireComponent();
          await ctx.runMutation(component.public.memberUpdate, {
            memberId,
            data,
          });
        },
      },

      /**
       * Manage group invitations. Invites track pending, accepted, revoked,
       * and expired invitations to join a group.
       */
      invite: {
        /**
         * Create a new invitation to join a group.
         *
         * @param data.groupId - The group to invite the user to.
         * @param data.invitedByUserId - The user sending the invitation.
         * @param data.email - The email address of the invitee.
         * @param data.tokenHash - Hashed token for secure acceptance.
         * @param data.role - Optional role to assign on acceptance.
         * @param data.status - Initial status (typically "pending").
         * @param data.expiresTime - Timestamp when the invite expires.
         * @param data.extend - Optional arbitrary JSON extension data.
         * @returns The ID of the new invite record.
         */
        create: async (
          ctx: ComponentCtx,
          data: {
            groupId?: string;
            invitedByUserId: string;
            email: string;
            tokenHash: string;
            role?: string;
            status: "pending" | "accepted" | "revoked" | "expired";
            expiresTime: number;
            extend?: Record<string, unknown>;
          },
        ): Promise<string> => {
          const component = requireComponent();
          return (await ctx.runMutation(
            component.public.inviteCreate,
            data,
          )) as string;
        },
        /**
         * Retrieve an invite by its ID. Returns `null` if not found.
         */
        get: async (ctx: ComponentReadCtx, inviteId: string) => {
          const component = requireComponent();
          return await ctx.runQuery(component.public.inviteGet, { inviteId });
        },
        /**
         * List invites for a group, optionally filtered by status.
         */
        list: async (
          ctx: ComponentReadCtx,
          opts?: {
            groupId?: string;
            status?: "pending" | "accepted" | "revoked" | "expired";
          },
        ) => {
          const component = requireComponent();
          return await ctx.runQuery(component.public.inviteList, {
            groupId: opts?.groupId,
            status: opts?.status,
          });
        },
        /**
         * Accept an invitation. Marks the invite as "accepted" and records
         * the timestamp. The caller is responsible for creating the member
         * record via `auth.group.member.add`.
         */
        accept: async (ctx: ComponentCtx, inviteId: string) => {
          const component = requireComponent();
          await ctx.runMutation(component.public.inviteAccept, { inviteId });
        },
        /**
         * Revoke a pending invitation.
         */
        revoke: async (ctx: ComponentCtx, inviteId: string) => {
          const component = requireComponent();
          await ctx.runMutation(component.public.inviteRevoke, { inviteId });
        },
      },
    },
    /**
     * Add HTTP actions for JWT verification and OAuth sign-in.
     *
     * ```ts
     * import { httpRouter } from "convex/server";
     * import { auth } from "./auth.js";
     *
     * const http = httpRouter();
     *
     * auth.addHttpRoutes(http);
     *
     * export default http;
     * ```
     *
     * The following routes are handled always:
     *
     * - `/.well-known/openid-configuration`
     * - `/.well-known/jwks.json`
     *
     * The following routes are handled if OAuth is configured:
     *
     * - `/api/auth/signin/*`
     * - `/api/auth/callback/*`
     *
     * @param http your HTTP router
     */
    addHttpRoutes: (http: HttpRouter) => {
      http.route({
        path: "/.well-known/openid-configuration",
        method: "GET",
        handler: httpActionGeneric(async () => {
          return new Response(
            JSON.stringify({
              issuer: requireEnv("CONVEX_SITE_URL"),
              jwks_uri:
                requireEnv("CONVEX_SITE_URL") + "/.well-known/jwks.json",
              authorization_endpoint:
                requireEnv("CONVEX_SITE_URL") + "/oauth/authorize",
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control":
                  "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
              },
            },
          );
        }),
      });

      http.route({
        path: "/.well-known/jwks.json",
        method: "GET",
        handler: httpActionGeneric(async () => {
          return new Response(requireEnv("JWKS"), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control":
                "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
            },
          });
        }),
      });

      if (hasOAuth) {
        http.route({
          pathPrefix: "/api/auth/signin/",
          method: "GET",
          handler: httpActionGeneric(
            convertErrorsToResponse(400, async (ctx, request) => {
              const url = new URL(request.url);
              const pathParts = url.pathname.split("/");
              const providerId = pathParts.at(-1)!;
              if (providerId === null) {
                throw new Error("Missing provider id");
              }
              const verifier = url.searchParams.get("code");
              if (verifier === null) {
                throw new Error("Missing sign-in verifier");
              }
              const provider = getProviderOrThrow(
                providerId,
              ) as OAuthConfig<any>;
              const { redirect, cookies, signature } =
                await getAuthorizationUrl({
                  provider: await oAuthConfigToInternalProvider(provider),
                  cookies: defaultCookiesOptions(providerId),
                });

              await callVerifierSignature(ctx, {
                verifier,
                signature,
              });

              const redirectTo = url.searchParams.get("redirectTo");

              if (redirectTo !== null) {
                cookies.push(redirectToParamCookie(providerId, redirectTo));
              }

              const headers = new Headers({ Location: redirect });
              for (const { name, value, options } of cookies) {
                headers.append(
                  "Set-Cookie",
                  serializeCookie(name, value, options),
                );
              }

              return new Response(null, { status: 302, headers });
            }),
          ),
        });

        const callbackAction = httpActionGeneric(
          async (genericCtx, request) => {
            const ctx = genericCtx as unknown as ActionCtx;
            const url = new URL(request.url);
            const pathParts = url.pathname.split("/");
            const providerId = pathParts.at(-1)!;
            logWithLevel(
              LOG_LEVELS.DEBUG,
              "Handling OAuth callback for provider:",
              providerId,
            );
            const provider = getProviderOrThrow(
              providerId,
            ) as OAuth2Config<any>;

            const cookies = getCookies(request);

            const maybeRedirectTo = useRedirectToParam(provider.id, cookies);

            const destinationUrl = await redirectAbsoluteUrl(config, {
              redirectTo: maybeRedirectTo?.redirectTo,
            });

            const params = url.searchParams;

            // Handle OAuth providers that use formData (such as Apple)
            if (
              request.headers.get("Content-Type") ===
              "application/x-www-form-urlencoded"
            ) {
              const formData = await request.formData();
              for (const [key, value] of formData.entries()) {
                if (typeof value === "string") {
                  params.append(key, value);
                }
              }
            }

            try {
              const { profile, tokens, signature } = await handleOAuth(
                Object.fromEntries(params.entries()),
                cookies,
                {
                  provider: await oAuthConfigToInternalProvider(provider),
                  cookies: defaultCookiesOptions(provider.id),
                },
              );

              const { id, ...profileFromCallback } = await provider.profile!(
                profile,
                tokens,
              );

              if (typeof id !== "string") {
                throw new Error(
                  `The profile method of the ${providerId} config must return a string ID`,
                );
              }

              const verificationCode = await callUserOAuth(ctx, {
                provider: providerId,
                providerAccountId: id,
                profile: profileFromCallback,
                signature,
              });

              return new Response(null, {
                status: 302,
                headers: {
                  Location: setURLSearchParam(
                    destinationUrl,
                    "code",
                    verificationCode,
                  ),
                  "Cache-Control": "must-revalidate",
                },
              });
            } catch (error) {
              logError(error);
              return Response.redirect(destinationUrl);
            }
          },
        );

        http.route({
          pathPrefix: "/api/auth/callback/",
          method: "GET",
          handler: callbackAction,
        });

        http.route({
          pathPrefix: "/api/auth/callback/",
          method: "POST",
          handler: callbackAction,
        });
      }
    },
  };
  return {
    /**
     * Helper for configuring HTTP actions.
     */
    auth,
    /**
     * Action called by the client to sign the user in.
     *
     * Also used for refreshing the session.
     */
    signIn: actionGeneric({
      args: {
        provider: v.optional(v.string()),
        params: v.optional(v.any()),
        verifier: v.optional(v.string()),
        refreshToken: v.optional(v.string()),
        calledBy: v.optional(v.string()),
      },
      handler: async (
        ctx,
        args,
      ): Promise<{
        redirect?: string;
        verifier?: string;
        tokens?: Tokens | null;
        started?: boolean;
      }> => {
        if (args.calledBy !== undefined) {
          logWithLevel("INFO", `\`auth:signIn\` called by ${args.calledBy}`);
        }
        const provider =
          args.provider !== undefined
            ? getProviderOrThrow(args.provider)
            : null;
        const result = await signInImpl(enrichCtx(ctx), provider, args, {
          generateTokens: true,
          allowExtraProviders: false,
        });
        switch (result.kind) {
          case "redirect":
            return { redirect: result.redirect, verifier: result.verifier };
          case "signedIn":
          case "refreshTokens":
            return { tokens: result.signedIn?.tokens ?? null };
          case "started":
            return { started: true };
          default: {
            const _typecheck: never = result;
            throw new Error(`Unexpected result from signIn, ${result as any}`);
          }
        }
      },
    }),
    /**
     * Action called by the client to invalidate the current session.
     */
    signOut: actionGeneric({
      args: {},
      handler: async (ctx) => {
        await callSignOut(ctx);
      },
    }),

    /**
     * Internal mutation used by the library to read and write
     * to the database during signin and signout.
     */
    store: internalMutationGeneric({
      args: storeArgs,
      handler: async (ctx: MutationCtx, args) => {
        return storeImpl(ctx, args, getProviderOrThrow, config);
      },
    }),

  };
}

/**
 * Return the currently signed-in user's ID.
 *
 * ```ts filename="convex/myFunctions.tsx"
 * import { mutation } from "./_generated/server";
 * import { getAuthUserId } from "@robelest/convex-auth/component";
 *
 * export const doSomething = mutation({
 *   args: {/* ... *\/},
 *   handler: async (ctx, args) => {
 *     const userId = await getAuthUserId(ctx);
 *     if (userId === null) {
 *       throw new Error("Client is not authenticated!")
 *     }
 *     const user = await ctx.db.get(userId);
 *     // ...
 *   },
 * });
 * ```
 *
 * @param ctx query, mutation or action `ctx`
 * @returns the user ID or `null` if the client isn't authenticated
 */
export async function getAuthUserId(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }
  const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
  return userId as GenericId<"user">;
}

/**
 * Use this function from a
 * [`ConvexCredentials`](https://labs.convex.dev/auth/api_reference/providers/ConvexCredentials)
 * provider to create an account and a user with a unique account "id" (OAuth
 * provider ID, email address, phone number, username etc.).
 *
 * @returns user ID if it successfully creates the account
 * or throws an error.
 */
export async function createAccount<
  DataModel extends GenericDataModel = GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: {
    /**
     * The provider ID (like "password"), used to disambiguate accounts.
     *
     * It is also used to configure account secret hashing via the provider's
     * `crypto` option.
     */
    provider: string;
    account: {
      /**
       * The unique external ID for the account, for example email address.
       */
      id: string;
      /**
       * The secret credential to store for this account, if given.
       */
      secret?: string;
    };
    /**
     * The profile data to store for the user.
     * These must fit the `users` table schema.
     */
    profile: WithoutSystemFields<DocumentByName<DataModel, "user">>;
    /**
     * If `true`, the account will be linked to an existing user
     * with the same verified email address.
     * This is only safe if the returned account's email is verified
     * before the user is allowed to sign in with it.
     */
    shouldLinkViaEmail?: boolean;
    /**
     * If `true`, the account will be linked to an existing user
     * with the same verified phone number.
     * This is only safe if the returned account's phone is verified
     * before the user is allowed to sign in with it.
     */
    shouldLinkViaPhone?: boolean;
  },
): Promise<{
  account: GenericDoc<DataModel, "account">;
  user: GenericDoc<DataModel, "user">;
}> {
  const actionCtx = ctx as unknown as ActionCtx;
  return (await callCreateAccountFromCredentials(
    actionCtx,
    args as any,
  )) as any;
}

/**
 * Use this function from a
 * [`ConvexCredentials`](https://labs.convex.dev/auth/api_reference/providers/ConvexCredentials)
 * provider to retrieve a user given the account provider ID and
 * the provider-specific account ID.
 *
 * @returns the retrieved user document, or `null` if there is no account
 * for given account ID or throws if the provided
 * secret does not match.
 */
export async function retrieveAccount<
  DataModel extends GenericDataModel = GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: {
    /**
     * The provider ID (like "password"), used to disambiguate accounts.
     *
     * It is also used to configure account secret hashing via the provider's
     * `crypto` option.
     */
    provider: string;
    account: {
      /**
       * The unique external ID for the account, for example email address.
       */
      id: string;
      /**
       * The secret that should match the stored credential, if given.
       */
      secret?: string;
    };
  },
): Promise<{
  account: GenericDoc<DataModel, "account">;
  user: GenericDoc<DataModel, "user">;
}> {
  const actionCtx = ctx as unknown as ActionCtx;
  const result = await callRetreiveAccountWithCredentials(actionCtx, args);
  if (typeof result === "string") {
    throw new Error(result);
  }
  return result as any;
}

/**
 * Use this function to modify the account credentials
 * from a [`ConvexCredentials`](https://labs.convex.dev/auth/api_reference/providers/ConvexCredentials)
 * provider.
 */
export async function modifyAccountCredentials<
  DataModel extends GenericDataModel = GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: {
    /**
     * The provider ID (like "password"), used to disambiguate accounts.
     *
     * It is also used to configure account secret hashing via the `crypto` option.
     */
    provider: string;
    account: {
      /**
       * The unique external ID for the account, for example email address.
       */
      id: string;
      /**
       * The new secret credential to store for this account.
       */
      secret: string;
    };
  },
): Promise<void> {
  const actionCtx = ctx as unknown as ActionCtx;
  return await callModifyAccount(actionCtx, args);
}

/**
 * Use this function to invalidate existing sessions.
 */
export async function invalidateSessions<
  DataModel extends GenericDataModel = GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: {
    userId: GenericId<"user">;
    except?: GenericId<"session">[];
  },
): Promise<void> {
  const actionCtx = ctx as unknown as ActionCtx;
  return await callInvalidateSessions(actionCtx, args);
}

/**
 * Use this function from a
 * [`ConvexCredentials`](https://labs.convex.dev/auth/api_reference/providers/ConvexCredentials)
 * provider to sign in the user via another provider (usually
 * for email verification on sign up or password reset).
 *
 * Returns the user ID if the sign can proceed,
 * or `null`.
 */
export async function signInViaProvider<
  DataModel extends GenericDataModel = GenericDataModel,
>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  provider: AuthProviderConfig,
  args: {
    accountId?: GenericId<"account">;
    params?: Record<string, Value | undefined>;
  },
) {
  const result = await signInImpl(
    ctx,
    materializeProvider(provider),
    args as any,
    {
    generateTokens: false,
    allowExtraProviders: true,
    },
  );
  return result.kind === "signedIn"
    ? result.signedIn !== null
      ? { userId: result.signedIn.userId, sessionId: result.signedIn.sessionId }
      : null
    : null;
}

function convertErrorsToResponse(
  errorStatusCode: number,
  action: (ctx: GenericActionCtx<any>, request: Request) => Promise<Response>,
) {
  return async (ctx: GenericActionCtx<any>, request: Request) => {
    try {
      return await action(ctx, request);
    } catch (error) {
      if (error instanceof ConvexError) {
        return new Response(null, {
          status: errorStatusCode,
          statusText: error.data,
        });
      } else {
        logError(error);
        return new Response(null, {
          status: 500,
          statusText: "Internal Server Error",
        });
      }
    }
  };
}
function getCookies(request: Request): Record<string, string | undefined> {
  return parseCookies(request.headers.get("Cookie") ?? "");
}
