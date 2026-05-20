import { isRetriableProxyRefreshError } from "@robelest/convex-auth/client/runtime/proxy";
import { expect, test } from "vite-plus/test";

test("isRetriableProxyRefreshError retries 429", () => {
  const err429 = new Error("Proxy request failed: 429");
  expect(isRetriableProxyRefreshError(err429)).toBe(true);
});

test("isRetriableProxyRefreshError still retries 5xx", () => {
  expect(isRetriableProxyRefreshError(new Error("Proxy request failed: 503"))).toBe(true);
});

test("isRetriableProxyRefreshError does not retry 4xx other than 429", () => {
  expect(isRetriableProxyRefreshError(new Error("Proxy request failed: 401"))).toBe(false);
  expect(isRetriableProxyRefreshError(new Error("Proxy request failed: 403"))).toBe(false);
  expect(isRetriableProxyRefreshError(new Error("Proxy request failed: 404"))).toBe(false);
});
