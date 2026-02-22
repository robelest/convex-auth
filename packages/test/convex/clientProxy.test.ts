import { client, parseAuthError } from "../../auth/src/client/index";
import { afterEach, expect, test, vi } from "vitest";

async function waitForSetAuthCalls(
  convex: ReturnType<typeof createConvexMock>,
  count: number,
): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  while (convex.setAuth.mock.calls.length < count) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for setAuth calls (${count})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createConvexMock() {
  const authRegistrations: Array<{
    fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
    onChange?: (isAuthenticated: boolean) => void;
  }> = [];

  return {
    action: vi.fn(async () => null),
    setAuth: vi.fn((fetchToken, onChange) => {
      authRegistrations.push({ fetchToken, onChange });
    }),
    clearAuth: vi.fn(),
    authRegistrations,
    triggerAuthChange(isAuthenticated: boolean) {
      authRegistrations[authRegistrations.length - 1]?.onChange?.(isAuthenticated);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  const resultPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(true);
  const result = await resultPromise;

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

test("proxy signIn waits for Convex auth confirmation", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy: "/api/auth",
    token: "existing-token",
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
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
      ),
    ),
  );

  let resolved = false;
  const signInPromise = auth
    .signIn("password", {
      email: "sarah@gmail.com",
      password: "44448888",
      flow: "signIn",
    })
    .then((value) => {
      resolved = true;
      return value;
    });

  await waitForSetAuthCalls(convex, 2);
  expect(resolved).toBe(false);

  convex.triggerAuthChange(true);
  const result = await signInPromise;
  expect(result.signingIn).toBe(true);

  auth.destroy();
});

test("proxy signIn fails with structured error when auth rejected", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy: "/api/auth",
    token: "existing-token",
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
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
      ),
    ),
  );

  const signInPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(false);

  await expect(signInPromise).rejects.toSatisfy((error: unknown) => {
    return parseAuthError(error)?.code === "AUTH_HANDSHAKE_REJECTED";
  });

  auth.destroy();
});

test("proxy signIn times out when auth confirmation never arrives", async () => {
  vi.useFakeTimers();
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy: "/api/auth",
    token: "existing-token",
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
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
      ),
    ),
  );

  const signInPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  const rejection = expect(signInPromise).rejects.toSatisfy((error: unknown) => {
    return parseAuthError(error)?.code === "AUTH_HANDSHAKE_TIMEOUT";
  });
  await vi.advanceTimersByTimeAsync(5001);
  await rejection;

  auth.destroy();
  vi.useRealTimers();
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
