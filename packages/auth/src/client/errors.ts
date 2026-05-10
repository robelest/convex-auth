import { ConvexError, Value } from "convex/values";

const HANDSHAKE_ERROR_MESSAGES = {
  AUTH_HANDSHAKE_TIMEOUT: "Sign-in succeeded but authentication confirmation timed out.",
  AUTH_HANDSHAKE_REJECTED: "Authentication was rejected while confirming the session.",
} as const;

type ClientHandshakeErrorCode = keyof typeof HANDSHAKE_ERROR_MESSAGES;

/** @internal */
export const createHandshakeError = (
  code: ClientHandshakeErrorCode,
  context: Record<string, unknown>,
) => {
  return new ConvexError({
    code,
    message: HANDSHAKE_ERROR_MESSAGES[code],
    ...context,
  } as Value);
};
