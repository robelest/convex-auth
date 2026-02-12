import { OAuth2Config, OAuthConfig } from "@auth/core/providers";
import {
  Auth,
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  actionGeneric,
  httpActionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { ConvexError, GenericId, v } from "convex/values";
import { parse as parseCookies, serialize as serializeCookie } from "cookie";
import { redirectToParamCookie, useRedirectToParam } from "../cookies.js";
import { FunctionReferenceFromExport } from "../convex_types.js";
import {
  configDefaults,
  listAvailableProviders,
  materializeProvider,
} from "../provider_utils.js";
import {
  AuthProviderConfig,
  ConvexAuthConfig,
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
 * import { components } from "./_generated/api";
 *
 * export const { auth, signIn, signOut, store } = Auth({
 *   component: components.auth,
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
  type ComponentCtx = Pick<
    GenericActionCtx<GenericDataModel>,
    "runQuery" | "runMutation"
  >;
  type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
  type ComponentAuthReadCtx = ComponentReadCtx & { auth: Auth };
  type AccountCredentials = { id: string; secret?: string };
  type CreateAccountArgs = {
    provider: string;
    account: AccountCredentials;
    profile: Record<string, unknown>;
    shouldLinkViaEmail?: boolean;
    shouldLinkViaPhone?: boolean;
  };
  type RetrieveAccountArgs = { provider: string; account: AccountCredentials };
  type UpdateAccountCredentialsArgs = {
    provider: string;
    account: { id: string; secret: string };
  };

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
        return await ctx.runQuery(config.component.public.userGetById, { userId });
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
        return await ctx.runQuery(config.component.public.userGetById, { userId });
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
          return await ctx.runQuery(config.component.public.memberListByUser, opts);
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
          return await ctx.runQuery(
            config.component.public.memberGetByGroupAndUser,
            opts,
          );
        },
      },
    },
    session: {
      /**
       * Get the current session ID from the auth context, or `null` if
       * not signed in.
       */
      current: async (ctx: { auth: Auth }) => {
        const identity = await ctx.auth.getUserIdentity();
        if (identity === null) {
          return null;
        }
        const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
        return sessionId as GenericId<"session">;
      },
      /**
       * Invalidate sessions for a user, optionally preserving specific sessions.
       */
      invalidate: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: {
          userId: GenericId<"user">;
          except?: GenericId<"session">[];
        },
      ): Promise<void> => {
        const actionCtx = ctx as unknown as ActionCtx;
        return await callInvalidateSessions(actionCtx, args);
      },
    },
    account: {
      /**
       * Create an account and user for a credentials provider.
       */
      create: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: CreateAccountArgs,
      ) => {
        const actionCtx = ctx as unknown as ActionCtx;
        return await callCreateAccountFromCredentials(actionCtx, args as any);
      },
      /**
       * Retrieve an account and user for a credentials provider.
       */
      get: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: RetrieveAccountArgs,
      ) => {
        const actionCtx = ctx as unknown as ActionCtx;
        const result = await callRetreiveAccountWithCredentials(actionCtx, args);
        if (typeof result === "string") {
          throw new Error(result);
        }
        return result;
      },
      /**
       * Update credentials for an existing account.
       */
      updateCredentials: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        args: UpdateAccountCredentialsArgs,
      ): Promise<void> => {
        const actionCtx = ctx as unknown as ActionCtx;
        return await callModifyAccount(actionCtx, args);
      },
    },
    provider: {
      /**
       * Sign in via another provider, typically from a credentials flow.
       */
      signIn: async <DataModel extends GenericDataModel>(
        ctx: GenericActionCtx<DataModel>,
        provider: AuthProviderConfig,
        args: {
          accountId?: GenericId<"account">;
          params?: Record<string, unknown>;
        },
      ) => {
        const result = await signInImpl(
          enrichCtx(ctx),
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
        return (await ctx.runMutation(
          config.component.public.groupCreate,
          data,
        )) as string;
      },
      /**
       * Retrieve a group by its ID. Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, groupId: string) => {
        return await ctx.runQuery(config.component.public.groupGet, { groupId });
      },
      /**
       * List groups. When `parentGroupId` is provided, returns children of
       * that group. When omitted, returns root-level groups (no parent).
       */
      list: async (ctx: ComponentReadCtx, opts?: { parentGroupId?: string }) => {
        return await ctx.runQuery(config.component.public.groupList, {
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
        await ctx.runMutation(config.component.public.groupUpdate, { groupId, data });
      },
      /**
       * Delete a group and cascade to all descendants. Deletes child groups
       * (recursively), all members, and all invites for this group and its
       * descendants.
       */
      delete: async (ctx: ComponentCtx, groupId: string) => {
        await ctx.runMutation(config.component.public.groupDelete, { groupId });
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
         * @throws ConvexError with code `DUPLICATE_MEMBERSHIP` if the user is
         * already a member of the target group.
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
          return (await ctx.runMutation(
            config.component.public.memberAdd,
            data,
          )) as string;
        },
        /**
         * Retrieve a member record by its ID. Returns `null` if not found.
         */
        get: async (ctx: ComponentReadCtx, memberId: string) => {
          return await ctx.runQuery(config.component.public.memberGet, { memberId });
        },
        /**
         * List all members of a group.
         */
        list: async (ctx: ComponentReadCtx, opts: { groupId: string }) => {
          return await ctx.runQuery(config.component.public.memberList, opts);
        },
        /**
         * Remove a member from a group by deleting the member record.
         */
        remove: async (ctx: ComponentCtx, memberId: string) => {
          await ctx.runMutation(config.component.public.memberRemove, { memberId });
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
          await ctx.runMutation(config.component.public.memberUpdate, {
            memberId,
            data,
          });
        },
      },

    },
    /**
     * Manage platform-level invitations.
     *
     * Invites can optionally target a group by setting `groupId`, but they do
     * not require groups and can be used in apps with user-only collaboration.
     */
    invite: {
      /**
       * Create a new invitation.
       *
       * @param data.groupId - Optional group to invite the user into.
       * @param data.invitedByUserId - The user sending the invitation.
       * @param data.email - The email address of the invitee.
       * @param data.tokenHash - Hashed token for secure acceptance.
       * @param data.role - Optional role to assign on acceptance.
       * @param data.status - Initial status (typically "pending").
       * @param data.expiresTime - Timestamp when the invite expires.
       * @param data.extend - Optional arbitrary JSON extension data.
       * @throws ConvexError with code `DUPLICATE_INVITE` if a pending invite
       * already exists for this email and scope.
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
        return (await ctx.runMutation(config.component.public.inviteCreate, data)) as string;
      },
      /**
       * Retrieve an invite by its ID. Returns `null` if not found.
       */
      get: async (ctx: ComponentReadCtx, inviteId: string) => {
        return await ctx.runQuery(config.component.public.inviteGet, { inviteId });
      },
      /**
       * List invites, optionally filtered by group and/or status.
       */
      list: async (
        ctx: ComponentReadCtx,
        opts?: {
          groupId?: string;
          status?: "pending" | "accepted" | "revoked" | "expired";
        },
      ) => {
        return await ctx.runQuery(config.component.public.inviteList, {
          groupId: opts?.groupId,
          status: opts?.status,
        });
      },
      /**
       * Accept an invitation. Marks the invite as "accepted" and records
       * the timestamp. If the invite has a group, the caller is responsible
       * for creating the member record via `auth.group.member.add` in the
       * same Convex mutation for transactional safety.
        *
        * @throws ConvexError with code `INVITE_NOT_FOUND` when the invite does
        * not exist.
        * @throws ConvexError with code `INVITE_NOT_PENDING` when the invite is
        * not in `pending` status.
       *
       * ```ts
        * export const acceptInvite = mutation({
        *   args: { inviteId: v.string() },
       *   handler: async (ctx, { inviteId }) => {
       *     const userId = await auth.user.require(ctx);
       *     const invite = await auth.invite.get(ctx, inviteId);
       *     if (!invite) throw new Error("Invite not found");
       *
       *     await auth.invite.accept(ctx, inviteId);
       *     if (invite.groupId) {
       *       await auth.group.member.add(ctx, {
       *         groupId: invite.groupId,
       *         userId,
       *         role: invite.role,
       *       });
       *     }
       *   },
       * });
       * ```
       */
      accept: async (ctx: ComponentCtx, inviteId: string) => {
        await ctx.runMutation(config.component.public.inviteAccept, { inviteId });
      },
       /**
        * Revoke a pending invitation.
        *
        * @throws ConvexError with code `INVITE_NOT_FOUND` when the invite does
        * not exist.
        * @throws ConvexError with code `INVITE_NOT_PENDING` when the invite is
        * not in `pending` status.
        */
      revoke: async (ctx: ComponentCtx, inviteId: string) => {
        await ctx.runMutation(config.component.public.inviteRevoke, { inviteId });
      },
    },
    /**
     * Manage passkey credentials for users.
     *
     * ```ts
     * const passkeys = await auth.passkey.list(ctx, { userId });
     * await auth.passkey.rename(ctx, passkeyId, "MacBook Touch ID");
     * await auth.passkey.remove(ctx, passkeyId);
     * ```
     */
    passkey: {
      /**
       * List all passkeys for a user.
       *
       * @param opts.userId - The user whose passkeys to list.
       * @returns Array of passkey records with credentialId, name, deviceType,
       * backedUp, createdAt, and lastUsedAt.
       */
      list: async (ctx: ComponentReadCtx, opts: { userId: string }) => {
        return await ctx.runQuery(
          config.component.public.passkeyListByUserId,
          opts,
        );
      },
      /**
       * Rename a passkey (set a user-friendly display name).
       *
       * @param passkeyId - The passkey document ID.
       * @param name - New display name (e.g. "MacBook Touch ID").
       */
      rename: async (ctx: ComponentCtx, passkeyId: string, name: string) => {
        await ctx.runMutation(
          config.component.public.passkeyUpdateMeta,
          { passkeyId, data: { name } },
        );
      },
      /**
       * Delete a passkey credential.
       *
       * @param passkeyId - The passkey document ID to remove.
       */
      remove: async (ctx: ComponentCtx, passkeyId: string) => {
        await ctx.runMutation(
          config.component.public.passkeyDelete,
          { passkeyId },
        );
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
  const enrichCtx = <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => ({
    ...ctx,
    auth: {
      ...ctx.auth,
      config,
      account: auth.account,
      session: auth.session,
      provider: auth.provider,
    },
  });

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
        options?: Record<string, any>;
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
          case "passkeyOptions":
            return { options: result.options, verifier: result.verifier };
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
