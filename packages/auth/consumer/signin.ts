/**
 * Type-level tests for the `auth.signIn(...)` overload set.
 *
 * Every line below is a compile-only assertion. Lines marked
 * `@ts-expect-error` MUST fail typecheck — if any of them stops failing,
 * the typecheck step itself fails (TS error TS2578).
 */

import type { PlatformAuthClient } from "@robelest/convex-auth/client";

declare const auth: PlatformAuthClient;

// ---- valid calls ----

void auth.signIn("password", { flow: "signUp", email: "a@b.c", password: "12345678" });
void auth.signIn("password", { flow: "signIn", email: "a@b.c", password: "12345678" });
void auth.signIn("password", { flow: "reset", email: "a@b.c" });
void auth.signIn("password", { flow: "verify", email: "a@b.c", code: "000000" });
void auth.signIn("password", {
  flow: "verify",
  email: "a@b.c",
  code: "000000",
  newPassword: "newpass1!",
});
void auth.signIn("password", {
  flow: "change",
  email: "a@b.c",
  currentPassword: "oldpass",
  newPassword: "newpass1!",
});

void auth.signIn("email", { email: "a@b.c" });
void auth.signIn("email", { email: "a@b.c", redirectTo: "/dashboard" });

void auth.signIn("anonymous");
void auth.signIn("anonymous", {});
void auth.signIn("anonymous", { redirectTo: "/" });

void auth.signIn("sso", { connectionId: "conn_123" });

void auth.signIn("passkey");
void auth.signIn("passkey", { redirectTo: "/" });

// Code completion (no provider — used after email or reset)
void auth.signIn(undefined, { code: "abc" });

// Generic OAuth fallback
void auth.signIn("google");
void auth.signIn("google", { redirectTo: "/dashboard" });
void auth.signIn("github", { redirectTo: "/dashboard" });
void auth.signIn("custom-oidc-provider");
void auth.signIn("custom-oidc-provider", {});

// ---- invalid calls (must fail typecheck) ----

// @ts-expect-error — `change` flow requires `currentPassword`
void auth.signIn("password", { flow: "change", email: "a@b.c", newPassword: "newpass1!" });

// @ts-expect-error — `change` flow requires `newPassword`
void auth.signIn("password", { flow: "change", email: "a@b.c", currentPassword: "oldpass" });

// @ts-expect-error — `signIn` flow requires `password`
void auth.signIn("password", { flow: "signIn", email: "a@b.c" });

// @ts-expect-error — `flow` is required for the password provider
void auth.signIn("password", { email: "a@b.c", password: "12345678" });

// @ts-expect-error — `"rotate"` is not a valid password flow
void auth.signIn("password", { flow: "rotate", email: "a@b.c", password: "x" });

// @ts-expect-error — `sso` requires `connectionId`
void auth.signIn("sso", {});

// @ts-expect-error — `email` requires `email` param
void auth.signIn("email", {});

// @ts-expect-error — code completion requires the `code` param
void auth.signIn(undefined, {});

// @ts-expect-error — `reset` flow requires `email`
void auth.signIn("password", { flow: "reset" });
