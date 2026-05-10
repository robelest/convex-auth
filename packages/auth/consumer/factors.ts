/**
 * Type-level tests for factor clients (passkey, totp, device).
 *
 * Every line is a compile-only assertion. Lines marked
 * `@ts-expect-error` MUST fail typecheck — if any of them stops failing,
 * tsc will report TS2578 ("Unused @ts-expect-error directive").
 */

import type {
  DeviceCodeResult,
  PlatformAuthClient,
  TotpSetupResult,
} from "@robelest/convex-auth/client";

declare const auth: PlatformAuthClient<
  // Force passkey + totp + device into the type to exercise their helpers.
  import("@robelest/convex-auth/client").AuthApiRefs<true, true, true>
>;
declare const deviceCode: DeviceCodeResult;

// ---- passkey ----

void auth.passkey.isSupported();
void auth.passkey.isAutofillSupported();

void auth.passkey.register();
void auth.passkey.register({});
void auth.passkey.register({ name: "MacBook Pro" });
void auth.passkey.register({
  name: "MacBook Pro",
  email: "a@b.c",
  userName: "alice",
  userDisplayName: "Alice",
});

void auth.passkey.signIn();
void auth.passkey.signIn({ email: "a@b.c", autofill: true });

// @ts-expect-error — `name` must be string
void auth.passkey.register({ name: 123 });

// @ts-expect-error — `autofill` must be boolean
void auth.passkey.signIn({ autofill: "yes" });

// @ts-expect-error — unknown property
void auth.passkey.register({ unknownField: "x" });

// ---- totp ----

void auth.totp.setup();
void auth.totp.setup({ name: "My App" });
void auth.totp.setup({ name: "My App", accountName: "alice@example.com" });

const _setupResult: Promise<TotpSetupResult> = auth.totp.setup();
void _setupResult;

void auth.totp.confirm({ code: "123456", verifier: "v", totpId: "t" });
void auth.totp.verify({ code: "123456", verifier: "v" });

// @ts-expect-error — confirm requires `totpId`
void auth.totp.confirm({ code: "123456", verifier: "v" });

// @ts-expect-error — confirm requires `verifier`
void auth.totp.confirm({ code: "123456", totpId: "t" });

// @ts-expect-error — confirm requires `code`
void auth.totp.confirm({ verifier: "v", totpId: "t" });

// @ts-expect-error — verify requires `verifier`
void auth.totp.verify({ code: "123456" });

// @ts-expect-error — verify rejects extra field
void auth.totp.verify({ code: "123456", verifier: "v", totpId: "t" });

// ---- device ----

void auth.device.poll({ code: deviceCode });
void auth.device.verify({ code: "WDJB-MJHT" });

// @ts-expect-error — poll requires DeviceCodeResult, not a string
void auth.device.poll({ code: "WDJB-MJHT" });

// @ts-expect-error — verify requires `code`
void auth.device.verify({});

// @ts-expect-error — verify rejects DeviceCodeResult
void auth.device.verify({ code: deviceCode });
