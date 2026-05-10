/**
 * Shared auth result payload types used across client and server internals.
 *
 * @module
 * @internal
 */

/** @internal */
export type AuthTokens = {
  token: string;
  refreshToken: string;
};

/** @internal */
export type TotpSetupPayload = {
  uri: string;
  secret: string;
  totpId: string;
};

/** @internal */
export type DeviceCodePayload = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

/** @internal */
export type SignInSessionResult<TSession> = {
  kind: "signedIn";
  session: TSession;
};

/** @internal */
export type SignInRedirectResult<TRedirect = string> = {
  kind: "redirect";
  redirect: TRedirect;
  verifier: string;
};

/** @internal */
export type SignInStartResult = {
  kind: "started";
};

/** @internal */
export type SignInPasskeyOptionsResult = {
  kind: "passkeyOptions";
  options: Record<string, unknown>;
  verifier: string;
};

/** @internal */
export type SignInTotpChallengeResult = {
  kind: "totpRequired";
  verifier: string;
};

/** @internal */
export type SignInTotpSetupResult<TTotpSetup = TotpSetupPayload> = {
  kind: "totpSetup";
  totpSetup: TTotpSetup;
  verifier: string;
};

/** @internal */
export type SignInDeviceCodeResult<TDeviceCode = DeviceCodePayload> = {
  kind: "deviceCode";
  deviceCode: TDeviceCode;
};

/** @internal */
export type SignInFlowResult<TSession, TRedirect = string> =
  | SignInSessionResult<TSession>
  | SignInRedirectResult<TRedirect>
  | SignInStartResult
  | SignInPasskeyOptionsResult
  | SignInTotpChallengeResult
  | SignInTotpSetupResult
  | SignInDeviceCodeResult;
