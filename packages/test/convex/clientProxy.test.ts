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
  let authConfirmed = false;

  return {
    action: vi.fn(async () => null),
    setAuth: vi.fn((fetchToken, onChange) => {
      authRegistrations.push({ fetchToken, onChange });
    }),
    clearAuth: vi.fn(),
    protectedMutation: vi.fn(async () => {
      if (!authConfirmed) {
        throw new Error("UNAUTHORIZED");
      }
      return { ok: true };
    }),
    authRegistrations,
    triggerAuthChange(isAuthenticated: boolean) {
      authConfirmed = isAuthenticated;
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
    proxy_path: "/api/auth",
    token_seed: "server-token",
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

  const resultPromise = auth.sign_in("password", {
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

test("server token starts authenticated without loading handshake", () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "server-token",
  });

  expect(auth.state.phase).toBe("authenticated");
  expect(auth.state.isLoading).toBe(false);
  expect(auth.state.isAuthenticated).toBe(true);
  expect(auth.state.token).toBe("server-token");

  auth.destroy();
});

test("proxy signIn waits for Convex auth confirmation", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
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
    .sign_in("password", {
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

test("proxy signIn tolerates transient auth false before confirmation", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
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

  const signInPromise = auth.sign_in("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await Promise.resolve();
  await Promise.resolve();
  convex.triggerAuthChange(false);

  let settled = false;
  void signInPromise.finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);

  convex.triggerAuthChange(true);
  const result = await signInPromise;
  expect(result.signingIn).toBe(true);

  auth.destroy();
});

test("proxy signIn times out after rejection signal with no later confirmation", async () => {
  vi.useFakeTimers();
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
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

  const signInPromise = auth.sign_in("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await Promise.resolve();
  await Promise.resolve();
  convex.triggerAuthChange(false);

  const rejection = expect(signInPromise).rejects.toSatisfy((error: unknown) => {
    return parseAuthError(error)?.code === "AUTH_HANDSHAKE_TIMEOUT";
  });
  await vi.advanceTimersByTimeAsync(5001);
  await rejection;

  auth.destroy();
  vi.useRealTimers();
});

test("proxy signIn times out when auth confirmation never arrives", async () => {
  vi.useFakeTimers();
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
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

  const signInPromise = auth.sign_in("password", {
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

test("proxy refresh does not re-register Convex auth", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
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

  const fetchAccessToken = convex.setAuth.mock.calls[0]?.[0] as
    | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
    | undefined;
  expect(fetchAccessToken).toBeDefined();

  const refreshedToken = await fetchAccessToken!({ forceRefreshToken: true });
  expect(refreshedToken).toBe("fresh-token");
  expect(convex.setAuth).toHaveBeenCalledTimes(1);

  auth.destroy();
});

test("proxy refresh retries transient failures before succeeding", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
  });

  let attempts = 0;
  const fetchMock = vi.fn(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new TypeError("Failed to fetch");
    }
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

  const fetchAccessToken = convex.setAuth.mock.calls[0]?.[0] as
    | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
    | undefined;
  expect(fetchAccessToken).toBeDefined();

  const refreshedToken = await fetchAccessToken!({ forceRefreshToken: true });
  expect(refreshedToken).toBe("fresh-token");
  expect(fetchMock).toHaveBeenCalledTimes(3);

  auth.destroy();
});

test("ledger-like flow can call protected mutation immediately after signIn", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
    token_seed: "existing-token",
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

  const signInPromise = auth.sign_in("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  convex.triggerAuthChange(true);

  const signInResult = await signInPromise;
  expect(signInResult.signingIn).toBe(true);
  await expect(convex.protectedMutation()).resolves.toEqual({ ok: true });

  auth.destroy();
});

test("proxy refresh skips relative URL in server runtime", async () => {
  vi.stubGlobal("window", undefined as any);
  vi.stubGlobal("location", undefined as any);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const convex = createConvexMock();
  const auth = client({
    convex,
    proxy_path: "/api/auth",
  });

  const fetchAccessToken = convex.setAuth.mock.calls[0]?.[0] as
    | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
    | undefined;
  expect(fetchAccessToken).toBeDefined();

  const refreshedToken = await fetchAccessToken!({ forceRefreshToken: true });

  expect(refreshedToken).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(auth.state.phase).toBe("unauthenticated");
  expect(auth.state.isLoading).toBe(false);

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
    proxy_path: "/api/auth",
    token_seed: "",
  });

  expect(auth.state.token).toBeNull();
  expect(auth.state.isAuthenticated).toBe(false);

  auth.destroy();
});
