import { defineRoles } from "@robelest/convex-auth/authorization";
import { client } from "@robelest/convex-auth/client";
import {
  AuthCtx,
  createAuth,
  type ConvexAuthConfig,
  type InferAuth,
} from "@robelest/convex-auth/component";
import auth from "@robelest/convex-auth/convex.config";
import { parseAuthError } from "@robelest/convex-auth/errors";
import { OAuth } from "@robelest/convex-auth/providers";
import { Password } from "@robelest/convex-auth/providers/password";
import type { AuthResolvedContext } from "@robelest/convex-auth/server";

type _ClientFactory = typeof client;
type _DefineRolesFactory = typeof defineRoles;
type _AuthCtxFactory = typeof AuthCtx;
type _CreateAuthFactory = typeof createAuth;
type _AuthConfig = ConvexAuthConfig;
type _AuthResolvedContext = AuthResolvedContext;
type _OAuthFactory = typeof OAuth;
type _PasswordClass = typeof Password;
type _ConvexConfig = typeof auth;

declare const authLike: Parameters<typeof AuthCtx>[0];

const authCtx = AuthCtx(authLike, {
  authResolve: async (_ctx, fallback) => await fallback(),
  resolve: async (_ctx, _user, authState) => ({
    copiedGroupId: authState.groupId,
    canWrite: authState.grants.includes("posts.write"),
  }),
});

type _InferredAuth = InferAuth<typeof authCtx>;

const _inferredAuth: _InferredAuth = {
  getUserIdentity: async () => null,
  userId: "user_123" as any,
  user: {} as any,
  groupId: null,
  role: null,
  grants: [],
  copiedGroupId: null,
  canWrite: true,
};

void parseAuthError;
void _inferredAuth;

const _typecheck: {
  authCtx: _AuthCtxFactory;
  client: _ClientFactory;
  defineRoles: _DefineRolesFactory;
  createAuth: _CreateAuthFactory;
  config: _ConvexConfig;
  OAuth: _OAuthFactory;
  password: _PasswordClass;
  authConfig: _AuthConfig | null;
  resolvedAuth: _AuthResolvedContext | null;
} = {
  authCtx: AuthCtx,
  client,
  defineRoles,
  createAuth,
  config: auth,
  OAuth,
  password: Password,
  authConfig: null,
  resolvedAuth: null,
};

void _typecheck;
