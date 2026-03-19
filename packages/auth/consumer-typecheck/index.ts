import { client } from "@robelest/convex-auth/client";
import {
  createAuth,
  type ConvexAuthConfig,
} from "@robelest/convex-auth/component";
import auth from "@robelest/convex-auth/convex.config";
import { parseAuthError } from "@robelest/convex-auth/errors";
import { OAuth } from "@robelest/convex-auth/providers";
import { Password } from "@robelest/convex-auth/providers/password";

type _ClientFactory = typeof client;
type _CreateAuthFactory = typeof createAuth;
type _AuthConfig = ConvexAuthConfig;
type _OAuthFactory = typeof OAuth;
type _PasswordClass = typeof Password;
type _ConvexConfig = typeof auth;

void parseAuthError;

const _typecheck: {
  client: _ClientFactory;
  createAuth: _CreateAuthFactory;
  config: _ConvexConfig;
  OAuth: _OAuthFactory;
  password: _PasswordClass;
  authConfig: _AuthConfig | null;
} = {
  client,
  createAuth,
  config: auth,
  OAuth,
  password: Password,
  authConfig: null,
};

void _typecheck;
