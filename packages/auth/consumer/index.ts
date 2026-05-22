import { defineRoles } from "@robelest/convex-auth/authorization";
import { client as browserClient } from "@robelest/convex-auth/browser";
import { client } from "@robelest/convex-auth/client";
import {
  createAuth,
  type AuthApi,
  type AuthContextConfig,
  type ConvexAuthConfig,
  type InferAuth,
} from "@robelest/convex-auth/component";
import auth from "@robelest/convex-auth/convex.config";
import { client as expoClient } from "@robelest/convex-auth/expo";
import { password } from "@robelest/convex-auth/providers";
import { google } from "@robelest/convex-auth/providers/google";
import type { AuthContext } from "@robelest/convex-auth/server";

type _ClientFactory = typeof client;
type _BrowserClientFactory = typeof browserClient;
type _ExpoClientFactory = typeof expoClient;
type _DefineRolesFactory = typeof defineRoles;
type _AuthCtxFactory = AuthApi["ctx"];
type _AuthContextResolver = AuthApi["context"];
type _AuthHttpContextResolver = AuthApi["request"]["context"];
type _AuthContextConfig = AuthContextConfig;
type _CreateAuthFactory = typeof createAuth;
type _AuthConfig = ConvexAuthConfig;
type _AuthContext = AuthContext;
type _GoogleFactory = typeof google;
type _PasswordFactory = typeof password;
type _ConvexConfig = typeof auth;

declare const authLike: Pick<AuthApi, "ctx" | "context" | "request">;

const authCtx = authLike.ctx({
  resolve: async (_ctx, _user, authState) => ({
    copiedGroupId: authState.groupId,
    canWrite: authState.grants.includes("posts.write"),
  }),
});

const optionalContextPromise = authLike.context.optional({} as any);
const optionalHttpContextPromise = authLike.request.context.optional(
  {} as any,
  new Request("https://example.com"),
);

type _InferredAuth = InferAuth<typeof authCtx>;
type _OptionalContext = Awaited<typeof optionalContextPromise>;
type _OptionalHttpContext = Awaited<typeof optionalHttpContextPromise>;

const _inferredAuth: _InferredAuth = {
  getUserIdentity: async () => null,
  userId: "user_123" as any,
  user: {} as any,
  groupId: null,
  role: null,
  grants: [],
  copiedGroupId: null,
  canWrite: true,
  require: () => {},
};

void _inferredAuth;

const _optionalContext = null as unknown as _OptionalContext;
const _optionalHttpContext = null as unknown as _OptionalHttpContext;

void _optionalContext;
void _optionalHttpContext;

const _typecheck: {
  authCtx: _AuthCtxFactory;
  authContextResolver: _AuthContextResolver;
  authHttpContextResolver: _AuthHttpContextResolver;
  client: _ClientFactory;
  browserClient: _BrowserClientFactory;
  expoClient: _ExpoClientFactory;
  defineRoles: _DefineRolesFactory;
  createAuth: _CreateAuthFactory;
  config: _ConvexConfig;
  google: _GoogleFactory;
  password: _PasswordFactory;
  authConfig: _AuthConfig | null;
  authContextConfig: _AuthContextConfig | null;
  authContext: _AuthContext | null;
} = {
  authCtx: null as unknown as _AuthCtxFactory,
  authContextResolver: null as unknown as _AuthContextResolver,
  authHttpContextResolver: null as unknown as _AuthHttpContextResolver,
  client,
  browserClient,
  expoClient,
  defineRoles,
  createAuth,
  config: auth,
  google,
  password,
  authConfig: null,
  authContextConfig: null,
  authContext: null,
};

void _typecheck;
