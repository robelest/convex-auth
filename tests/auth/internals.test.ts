import { base64urlDecode, createBrowserRuntime } from "@robelest/convex-auth/browser/runtime";
import { localMutex } from "@robelest/convex-auth/client/runtime/mutex";
import { parseRefreshToken } from "@robelest/convex-auth/server/refresh";
import { createArcticOAuthClient } from "@robelest/convex-auth/server/oauth/factory";
import {
  createSamlPostBindingResponse,
  parseSamlIdpMetadata,
} from "@robelest/convex-auth/server/sso/saml";
import { expect, test } from "vite-plus/test";

test("refresh token parser rejects extra separators", () => {
  expect(() => parseRefreshToken("refresh|session|extra")).toThrow("INVALID_REFRESH_TOKEN");
});

test("base64urlDecode accepts unpadded values", () => {
  const decoded = base64urlDecode("YQ");
  expect(new TextDecoder().decode(decoded)).toBe("a");
});

test("localMutex continues queue after callback failure", async () => {
  const order: string[] = [];
  await Promise.all([
    localMutex("auth-internals", async () => {
      order.push("first");
      throw new Error("boom");
    }).catch(() => null),
    localMutex("auth-internals", async () => {
      order.push("second");
    }),
  ]);
  expect(order).toEqual(["first", "second"]);
});

test("browser proxy fetch fails clearly outside browser runtime", async () => {
  await expect(createBrowserRuntime().proxy?.fetch({}, "/auth")).rejects.toThrow(
    "Browser proxy fetch is unavailable outside the browser runtime.",
  );
});

test("SAML POST binding response escapes HTML attributes", async () => {
  const response = createSamlPostBindingResponse({
    endpoint: 'https://idp.example/sso?x="y"',
    parameter: "SAMLRequest",
    value: '<xml value="bad">',
    relayState: 'relay"state',
  });
  const html = await response.text();
  expect(html).toContain('action="https://idp.example/sso?x=&quot;y&quot;"');
  expect(html).toContain('value="&lt;xml value=&quot;bad&quot;&gt;"');
  expect(html).toContain('value="relay&quot;state"');
});

test("SAML metadata rejects DTD and entity declarations", () => {
  expect(() =>
    parseSamlIdpMetadata('<!DOCTYPE foo [<!ENTITY xxe "x">]><EntityDescriptor entityID="id" />'),
  ).toThrow("SAML metadata must not contain DTD or entity declarations.");
});

test("optional PKCE Arctic clients pass verifier through", async () => {
  const calls: Array<unknown[]> = [];
  const provider = {
    createAuthorizationURL(state: string, verifier: string, scopes: string[]) {
      calls.push(["authorize", state, verifier, scopes]);
      return new URL("https://idp.example/authorize");
    },
    async validateAuthorizationCode(code: string, verifier: string) {
      calls.push(["token", code, verifier]);
      return { data: { access_token: "access" } };
    },
  };
  const client = createArcticOAuthClient(
    provider as Parameters<typeof createArcticOAuthClient>[0],
    { pkce: "optional" },
  );

  client.createAuthorizationURL({ state: "state", codeVerifier: "verifier", scopes: ["openid"] });
  await client.validateAuthorizationCode({ code: "code", codeVerifier: "verifier" });

  expect(calls).toEqual([
    ["authorize", "state", "verifier", ["openid"]],
    ["token", "code", "verifier"],
  ]);
});
