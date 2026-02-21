import { client } from "../../auth/src/client/index";
import { afterEach, expect, test, vi } from "vitest";

function createConvexMock() {
  return {
    action: vi.fn(async () => null),
    setAuth: vi.fn(),
    clearAuth: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("proxy mode re-syncs convex auth after sign in", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy: "/api/auth",
    token: "server-token",
  });

  const fetchMock = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        tokens: {
          token: "fresh-token",
          refreshToken: "dummy",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  expect(result.signingIn).toBe(true);
  expect(convex.setAuth).toHaveBeenCalledTimes(2);

  const latestFetchAccessToken = convex.setAuth.mock.calls[1]?.[0] as
    | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
    | undefined;
  expect(latestFetchAccessToken).toBeDefined();
  expect(
    await latestFetchAccessToken!({ forceRefreshToken: false }),
  ).toBe("fresh-token");

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
    }),
  );

  auth.destroy();
});

test("empty SSR token is treated as signed out", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ tokens: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy: "/api/auth",
    token: "",
  });

  expect(auth.state.token).toBeNull();
  expect(auth.state.isAuthenticated).toBe(false);

  auth.destroy();
});
