import {
  readConvexDeployment,
  deploymentTypeFromAdminKey,
  doesAlreadyMatchTemplate,
  isPreviewDeployKey,
  stripDeploymentTypePrefix,
  templateToSource,
} from "@robelest/convex-auth/cli/index";
import { generateKeys } from "@robelest/convex-auth/cli/keys";
import { expect, test, vi } from "vite-plus/test";

function expectProcessExitSilently(fn: () => unknown) {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expectProcessExit(fn);
  } finally {
    error.mockRestore();
  }
}

function expectProcessExit(fn: () => unknown) {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ""}`);
  }) as never);
  try {
    expect(fn).toThrow(/process\.exit:1/);
  } finally {
    exit.mockRestore();
  }
}

// ---- templateToSource ----

test("templateToSource strips $$ markers", () => {
  const template = "const config = {$$\n  providers: [$$],$$\n};";
  const result = templateToSource(template);
  expect(result).toBe("const config = {\n  providers: [],\n};");
  expect(result).not.toContain("$$");
});

test("templateToSource returns unchanged string when no $$ markers", () => {
  const source = "const x = 1;";
  expect(templateToSource(source)).toBe(source);
});

// ---- doesAlreadyMatchTemplate ----

test("doesAlreadyMatchTemplate matches exact template", () => {
  const template = 'import { defineApp } from "convex/server";\n';
  const existing = 'import { defineApp } from "convex/server";\n';
  expect(doesAlreadyMatchTemplate(existing, template)).toBe(true);
});

test("doesAlreadyMatchTemplate matches template with wildcard content", () => {
  const template =
    'import { createAuth } from "@robelest/convex-auth/component";\n\nconst auth = createAuth(components.auth, {$$\n  providers: [$$],$$\n});\n';
  const existing =
    'import { createAuth } from "@robelest/convex-auth/component";\n\nconst auth = createAuth(components.auth, {\n  providers: [password()],\n});\n';
  expect(doesAlreadyMatchTemplate(existing, template)).toBe(true);
});

test("doesAlreadyMatchTemplate returns false for non-matching content", () => {
  const template = 'import { defineApp } from "convex/server";\n\napp.use(auth);\n';
  const existing = "// completely different file\nconsole.log('hello');\n";
  expect(doesAlreadyMatchTemplate(existing, template)).toBe(false);
});

// ---- stripDeploymentTypePrefix ----

test("stripDeploymentTypePrefix strips dev: prefix", () => {
  expect(stripDeploymentTypePrefix("dev:tall-forest-1234")).toBe("tall-forest-1234");
});

test("stripDeploymentTypePrefix strips prod: prefix", () => {
  expect(stripDeploymentTypePrefix("prod:happy-animal-5678")).toBe("happy-animal-5678");
});

test("stripDeploymentTypePrefix rejects untyped deployments", () => {
  expectProcessExitSilently(() => stripDeploymentTypePrefix("tall-forest-1234"));
});

// ---- deploymentTypeFromAdminKey ----

test("deploymentTypeFromAdminKey extracts prod type", () => {
  expect(deploymentTypeFromAdminKey("prod:deploymentName|secretkey")).toBe("prod");
});

test("deploymentTypeFromAdminKey extracts dev type", () => {
  expect(deploymentTypeFromAdminKey("dev:deploymentName|secretkey")).toBe("dev");
});

test("deploymentTypeFromAdminKey rejects untyped keys", () => {
  expectProcessExitSilently(() => deploymentTypeFromAdminKey("legacyKeyWithoutColons"));
});

test("readConvexDeployment allows self-hosted admin keys with explicit url", () => {
  expect(
    readConvexDeployment({
      url: "http://127.0.0.1:3210",
      adminKey: "convex-self-hosted|secretkey",
    }),
  ).toMatchObject({
    name: "http://127.0.0.1:3210",
    type: null,
  });
});

// ---- isPreviewDeployKey ----

test("isPreviewDeployKey identifies preview deploy keys", () => {
  // preview deploy key format: preview:team:project|key
  expect(isPreviewDeployKey("preview:team-slug:project-slug|secretkey")).toBe(true);
});

test("isPreviewDeployKey returns false for concrete preview deployment keys", () => {
  // concrete preview deployment key format: preview:deploymentName|key
  expect(isPreviewDeployKey("preview:deploymentName|secretkey")).toBe(false);
});

test("isPreviewDeployKey returns false for non-preview keys", () => {
  expect(isPreviewDeployKey("prod:deploymentName|secretkey")).toBe(false);
  expect(isPreviewDeployKey("dev:deploymentName|secretkey")).toBe(false);
});

test("isPreviewDeployKey returns false for keys without pipe separator", () => {
  expect(isPreviewDeployKey("preview:team:project")).toBe(false);
  expect(isPreviewDeployKey("legacyKey")).toBe(false);
});

// ---- generateKeys ----

test("generateKeys produces signing and secret-encryption keys", async () => {
  const keys = await generateKeys();

  // JWT_PRIVATE_KEY should be a PEM-encoded PKCS8 private key (spaces replace newlines)
  expect(keys.JWT_PRIVATE_KEY).toContain("-----BEGIN PRIVATE KEY-----");
  expect(keys.JWT_PRIVATE_KEY).toContain("-----END PRIVATE KEY-----");
  // The CLI collapses newlines to spaces for env var storage
  expect(keys.JWT_PRIVATE_KEY).not.toContain("\n");

  // JWKS should be valid JSON with a "keys" array
  const jwks = JSON.parse(keys.JWKS) as {
    keys: Array<Record<string, unknown>>;
  };
  expect(jwks.keys).toBeInstanceOf(Array);
  expect(jwks.keys.length).toBe(1);

  const jwk = jwks.keys[0];
  expect(jwk.use).toBe("sig");
  // Ed25519 signing keys — the CLI emits an OKP JWK with crv=Ed25519.
  expect(jwk.kty).toBe("OKP");
  expect(jwk.crv).toBe("Ed25519");
  // OKP public key component — raw 32-byte public key, base64url-encoded.
  expect(typeof jwk.x).toBe("string");

  expect(typeof keys.AUTH_SECRET_ENCRYPTION_KEY).toBe("string");
  expect(keys.AUTH_SECRET_ENCRYPTION_KEY.length).toBeGreaterThan(20);
});
