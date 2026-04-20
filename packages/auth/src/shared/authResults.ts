export type AuthTokens = {
  token: string;
  refreshToken: string;
};

export type TotpSetupPayload = {
  uri: string;
  secret: string;
  totpId: string;
};

export type DeviceCodePayload = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type SignInSessionResult<TSession> = {
  kind: "signedIn";
  session: TSession;
};

export type SignInRedirectResult<TRedirect = string> = {
  kind: "redirect";
  redirect: TRedirect;
  verifier: string;
};

export type SignInStartResult = {
  kind: "started";
};

export type SignInPasskeyOptionsResult = {
  kind: "passkeyOptions";
  options: Record<string, unknown>;
  verifier: string;
};

export type SignInTotpChallengeResult = {
  kind: "totpRequired";
  verifier: string;
};

export type SignInTotpSetupResult<TTotpSetup = TotpSetupPayload> = {
  kind: "totpSetup";
  totpSetup: TTotpSetup;
  verifier: string;
};

export type SignInDeviceCodeResult<TDeviceCode = DeviceCodePayload> = {
  kind: "deviceCode";
  deviceCode: TDeviceCode;
};

export type SignInFlowResult<TSession, TRedirect = string> =
  | SignInSessionResult<TSession>
  | SignInRedirectResult<TRedirect>
  | SignInStartResult
  | SignInPasskeyOptionsResult
  | SignInTotpChallengeResult
  | SignInTotpSetupResult
  | SignInDeviceCodeResult;
