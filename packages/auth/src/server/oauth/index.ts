import {
  createArcticOAuthClient as createArcticOAuthClientImpl,
  createOAuthProvider as createOAuthProviderImpl,
} from "./factory";
import {
  createOAuthAuthorizationURL as createOAuthAuthorizationURLImpl,
  getAuthorizationSignature as getAuthorizationSignatureImpl,
  handleOAuthCallback as handleOAuthCallbackImpl,
} from "./runtime";

export const createArcticOAuthClient = createArcticOAuthClientImpl;
export const createOAuthAuthorizationURL = createOAuthAuthorizationURLImpl;
export const createOAuthProvider = createOAuthProviderImpl;
export const getAuthorizationSignature = getAuthorizationSignatureImpl;
export const handleOAuthCallback = handleOAuthCallbackImpl;
