/**
 * Type-level tests for the `before` and `after` lifecycle callbacks.
 *
 * Compile-only assertions. Lines marked `@ts-expect-error` MUST fail
 * typecheck — TS error TS2578 if any directive becomes unused.
 */

import { credentials } from "@robelest/convex-auth/providers";
import type {
  AuthCallbacks,
  AuthEvent,
  BeforeEvent,
} from "@robelest/convex-auth/server";
import type { GenericId } from "convex/values";

// ---- AuthEvent narrowing ----

declare const event: AuthEvent;

if (event.kind === "signedIn") {
  // TS narrows: signedIn has sessionId
  const _s: string = event.sessionId;
  void _s;
  // @ts-expect-error — `passkeyId` is not on signedIn
  void event.passkeyId;
}

if (event.kind === "passkeyAdded") {
  const _id: string = event.passkeyId;
  const _cred: string = event.credentialId;
  void _id;
  void _cred;
  // @ts-expect-error — `email` is not on passkeyAdded
  void event.email;
}

if (event.kind === "emailVerified") {
  const _e: string = event.email;
  void _e;
  // @ts-expect-error — `phone` is not on emailVerified
  void event.phone;
}

if (event.kind === "passwordChanged") {
  // flow narrows to "reset" | "change"
  const _f: "reset" | "change" = event.flow;
  void _f;
}

// ---- BeforeEvent narrowing ----

declare const beforeEvent: BeforeEvent;

if (beforeEvent.kind === "redirect") {
  const _r: string = beforeEvent.redirectTo;
  void _r;
  // @ts-expect-error — `profile` not on redirect variant
  void beforeEvent.profile;
}

if (beforeEvent.kind === "link") {
  void beforeEvent.profile;
  void beforeEvent.existingUserId;
  // @ts-expect-error — `redirectTo` not on link variant
  void beforeEvent.redirectTo;
}

// ---- callbacks shape (valid) ----

const validCallbacks: AuthCallbacks = {
  async before(_ctx, ev) {
    if (ev.kind === "redirect") {
      // narrowed: ev.redirectTo is string
      return ev.redirectTo;
    }
    if (ev.kind === "link") {
      // narrowed: ev.profile, ev.existingUserId
      void ev.profile;
      return undefined;
    }
    return undefined;
  },
  async after(_ctx, ev) {
    if (ev.kind === "userCreated") {
      void ev.userId;
      void ev.profile;
    }
    if (ev.kind === "passkeyAdded") {
      void ev.passkeyId;
    }
  },
};
void validCallbacks;

// ---- invalid shapes ----

const badAfter: AuthCallbacks = {
  // @ts-expect-error — `after` must return Promise<void>
  after: async (): Promise<string> => "not void",
};
void badAfter;

// ---- new lifecycle event variants ----

if (event.kind === "passkeyRemoved") {
  const _userId: GenericId<"User"> = event.userId;
  const _passkeyId: GenericId<"Passkey"> = event.passkeyId;
  void _userId;
  void _passkeyId;
  // @ts-expect-error — `credentialId` is not on passkeyRemoved
  void event.credentialId;
}

if (event.kind === "totpRemoved") {
  const _userId: GenericId<"User"> = event.userId;
  const _totpId: GenericId<"TotpFactor"> = event.totpId;
  void _userId;
  void _totpId;
  // @ts-expect-error — `verified` is not on totpRemoved
  void event.verified;
}

if (event.kind === "accountUnlinked") {
  const _userId: GenericId<"User"> = event.userId;
  const _accountId: GenericId<"Account"> = event.accountId;
  const _provider: string = event.provider;
  void _userId;
  void _accountId;
  void _provider;
  // @ts-expect-error — `providerAccountId` is not on accountUnlinked
  void event.providerAccountId;
}

// ---- ctx.auth.{account.unlink, passkey.delete, totp.delete} typing ----

declare const passkeyIdFixture: GenericId<"Passkey">;
declare const totpIdFixture: GenericId<"TotpFactor">;
declare const accountIdFixture: GenericId<"Account">;

void credentials({
  authorize: async (_params, ctx) => {
    const passkeyResult = await ctx.auth.passkey.delete(ctx, {
      passkeyId: passkeyIdFixture,
    });
    const _pkUserId: GenericId<"User"> = passkeyResult.userId;
    const _pkId: GenericId<"Passkey"> = passkeyResult.passkeyId;
    void _pkUserId;
    void _pkId;

    const totpResult = await ctx.auth.totp.delete(ctx, { totpId: totpIdFixture });
    const _totpUserId: GenericId<"User"> = totpResult.userId;
    const _totpResultId: GenericId<"TotpFactor"> = totpResult.totpId;
    void _totpUserId;
    void _totpResultId;

    const unlinkResult = await ctx.auth.account.unlink(ctx, {
      accountId: accountIdFixture,
    });
    const _unlinkUserId: GenericId<"User"> = unlinkResult.userId;
    const _unlinkAccountId: GenericId<"Account"> = unlinkResult.accountId;
    const _unlinkProvider: string = unlinkResult.provider;
    void _unlinkUserId;
    void _unlinkAccountId;
    void _unlinkProvider;

    // @ts-expect-error — `passkeyId` is required
    void ctx.auth.passkey.delete(ctx, {});

    // @ts-expect-error — `totpId` is required
    void ctx.auth.totp.delete(ctx, {});

    // @ts-expect-error — `accountId` is required
    void ctx.auth.account.unlink(ctx, {});

    return null;
  },
});
