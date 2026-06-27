import { redirectAbsoluteUrl } from "@robelest/convex-auth/server/redirects";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

const SITE_URL = "http://localhost:5173";

let priorSiteUrl: string | undefined;
let priorSecondaryUrl: string | undefined;

beforeEach(() => {
  priorSiteUrl = process.env.SITE_URL;
  priorSecondaryUrl = process.env.SECONDARY_URL;
  process.env.SITE_URL = SITE_URL;
  delete process.env.SECONDARY_URL;
});

afterEach(() => {
  if (priorSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = priorSiteUrl;
  if (priorSecondaryUrl === undefined) delete process.env.SECONDARY_URL;
  else process.env.SECONDARY_URL = priorSecondaryUrl;
});

const resolve = (redirectTo: unknown) =>
  redirectAbsoluteUrl(null as never, null as never, { redirectTo });

test("relative redirectTo resolves against SITE_URL", async () => {
  expect(await resolve("/dashboard")).toBe(`${SITE_URL}/dashboard`);
  expect(await resolve("?next=1")).toBe(`${SITE_URL}?next=1`);
});

test("absolute redirectTo on the SITE_URL origin is allowed", async () => {
  expect(await resolve(`${SITE_URL}/welcome`)).toBe(`${SITE_URL}/welcome`);
});

test("absolute redirectTo on an unallowlisted origin falls back to SITE_URL", async () => {
  expect(await resolve("https://evil.com/steal")).toBe(SITE_URL);
  // Subdomain-confusion must not pass an origin check.
  expect(await resolve("https://localhost:5173.evil.com/x")).toBe(SITE_URL);
});

test("absolute redirectTo on a SECONDARY_URL origin is allowed", async () => {
  process.env.SECONDARY_URL = "https://staging.example.com,http://localhost:3000";
  expect(await resolve("https://staging.example.com/app")).toBe("https://staging.example.com/app");
  expect(await resolve("http://localhost:3000/cb")).toBe("http://localhost:3000/cb");
});

test("native deep-link redirectTo is allowed only when listed in SECONDARY_URL", async () => {
  expect(await resolve("demoexpo://auth?code=abc")).toBe(SITE_URL);
  process.env.SECONDARY_URL = "demoexpo://auth";
  expect(await resolve("demoexpo://auth?code=abc")).toBe("demoexpo://auth?code=abc");
  expect(await resolve("demoexpo://auth/cb?code=abc")).toBe("demoexpo://auth/cb?code=abc");
  expect(await resolve("demoexpo://auth")).toBe("demoexpo://auth");
});

test("native deep-link base prefix cannot be extended into a different authority", async () => {
  process.env.SECONDARY_URL = "demoexpo://auth";
  expect(await resolve("demoexpo://auth.evil?code=abc")).toBe(SITE_URL);
  expect(await resolve("demoexpo://authevil/cb")).toBe(SITE_URL);
});

test("omitted redirectTo falls back to SITE_URL", async () => {
  expect(await resolve(undefined)).toBe(SITE_URL);
});
