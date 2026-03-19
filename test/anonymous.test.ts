import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex.setup";
import { expectSignedInResult, signInViaMagicLink } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("sign in anonymously", async () => {
  const t = convexTest(schema);
  const tokens = expectSignedInResult(
    await t.action(api.auth.session.start, {
      provider: "anonymous",
    }),
  );
  expect(tokens).not.toBeNull();
});

test("anonymous sign-in is not auto-converted during email sign-in", async () => {
  const t = convexTest(schema);
  const tokens = expectSignedInResult(
    await t.action(api.auth.session.start, {
      provider: "anonymous",
    }),
  );
  const claims = decodeJwt(tokens!.token);
  const asAnonymous = t.withIdentity({ subject: claims.sub });
  const newTokens = await signInViaMagicLink(
    asAnonymous,
    "email",
    "mike@gmail.com",
  );
  expect(newTokens).not.toBeNull();

  const newClaims = decodeJwt(newTokens!.token);
  expect(newClaims.sub).not.toEqual(claims.sub);

  const oldViewer = await t
    .withIdentity({ subject: claims.sub })
    .query(api.users.viewer, {});
  expect(oldViewer?.isAnonymous).toEqual(true);

  const viewer = await t
    .withIdentity({ subject: newClaims.sub })
    .query(api.users.viewer, {});
  expect(viewer).toMatchObject({ email: "mike@gmail.com" });
  expect(viewer?.isAnonymous).not.toEqual(true);
});
