import {
  assertSafeFetchUrl,
  assertSafeIdpHost,
  assertSafeIdpFetchUrl,
  unsafeFetchUrlReason,
} from "../../packages/auth/src/shared/fetch/guard";
import { afterEach, expect, test } from "vite-plus/test";

const savedFlag = process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS;

afterEach(() => {
  if (savedFlag === undefined) {
    delete process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS;
  } else {
    process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS = savedFlag;
  }
});

test("unsafeFetchUrlReason allows public https and rejects internal fetch targets", () => {
  expect(
    unsafeFetchUrlReason("https://idp.example.com/.well-known/openid-configuration"),
  ).toBeNull();

  expect(unsafeFetchUrlReason("http://idp.example.com/")).toMatch(/https:/);
  expect(unsafeFetchUrlReason("https://metadata/")).toMatch(/not allowed/);

  for (const blocked of [
    "https://localhost/",
    "https://sso.localhost/",
    "https://idp.internal/",
    "https://idp.local/",
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://172.16.4.4/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:a9fe:a9fe]/",
  ]) {
    expect(unsafeFetchUrlReason(blocked), blocked).toMatch(/not allowed/);
  }
});

test("strict public fetch guard requires https and rejects internal targets", () => {
  delete process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS;
  expect(() => assertSafeFetchUrl("https://169.254.169.254/")).toThrow();
  expect(() => assertSafeFetchUrl("https://idp.internal/")).toThrow();
  expect(() => assertSafeFetchUrl("https://idp.example.com/")).not.toThrow();
  expect(() => assertSafeFetchUrl("http://idp.example.com/")).toThrow(/https:/);

  process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS = "1";
  expect(() => assertSafeFetchUrl("https://169.254.169.254/")).toThrow();
  expect(() => assertSafeFetchUrl("https://idp.internal/")).toThrow();
  expect(() => assertSafeFetchUrl("https://metadata/")).toThrow();
});

test("idp fetch guard allows http without disabling the host block", () => {
  delete process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS;
  expect(() => assertSafeIdpFetchUrl("https://idp.example.com/")).not.toThrow();
  expect(() =>
    assertSafeIdpFetchUrl("http://idp.example.com/.well-known/openid-configuration"),
  ).not.toThrow();
  expect(() =>
    assertSafeIdpFetchUrl("http://zitadel:8080/.well-known/openid-configuration"),
  ).not.toThrow();

  expect(() => assertSafeIdpFetchUrl("ftp://idp.example.com/")).toThrow(/http: or https:/);
  expect(() => assertSafeIdpFetchUrl("http://localhost/")).toThrow(/not allowed/);
  expect(() => assertSafeIdpFetchUrl("http://127.0.0.1/")).toThrow(/not allowed/);
  expect(() => assertSafeIdpFetchUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
    /not allowed/,
  );
  expect(() => assertSafeIdpFetchUrl("http://idp.internal/")).toThrow(/not allowed/);
});

test("idp fetch guard ignores the legacy private-host opt-out", () => {
  process.env.CONVEX_AUTH_ALLOW_PRIVATE_FETCH_HOSTS = "1";
  expect(() =>
    assertSafeIdpFetchUrl("http://zitadel:8080/.well-known/openid-configuration"),
  ).not.toThrow();
  expect(() => assertSafeIdpFetchUrl("http://10.0.0.5/.well-known/openid-configuration")).toThrow(
    /not allowed/,
  );
  expect(() =>
    assertSafeIdpFetchUrl("http://idp.internal/.well-known/openid-configuration"),
  ).toThrow(/not allowed/);
  expect(() => assertSafeIdpFetchUrl("http://127.0.0.1/")).toThrow(/not allowed/);
  expect(() => assertSafeIdpFetchUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
    /not allowed/,
  );
});

test("idp proxy host guard accepts any well-formed host and rejects injection/malformed values", () => {
  expect(() => assertSafeIdpHost("zitadel:8080")).not.toThrow();
  expect(() => assertSafeIdpHost("idp.example.com")).not.toThrow();
  expect(() => assertSafeIdpHost("localhost")).not.toThrow();
  expect(() => assertSafeIdpHost("127.0.0.1:8080")).not.toThrow();
  expect(() => assertSafeIdpHost("169.254.169.254")).not.toThrow();
  expect(() => assertSafeIdpHost("idp.internal")).not.toThrow();
  expect(() => assertSafeIdpHost("idp.example.com/path")).toThrow(/host value/);
  expect(() => assertSafeIdpHost("idp.example.com\r\nX-Test: true")).toThrow(/host value/);
});
