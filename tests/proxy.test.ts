import { client as browserClient } from "@robelest/convex-auth/browser";
import { client } from "@robelest/convex-auth/client";
import { ConvexError } from "convex/values";
import { afterEach, expect, test, vi } from "vite-plus/test";

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

function createProxyRuntime(
  fetchImpl: (body: Record<string, unknown>, proxyPath: string) => Promise<Response>,
) {
  return {
    fetch: fetchImpl,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("proxy mode re-syncs convex auth after sign in", async () => {
  const convex = createConvexMock();
  const fetchMock = vi.fn(async (_body: Record<string, unknown>, proxyPath: string) => {
    expect(proxyPath).toBe("/api/auth");
    return new Response(
      JSON.stringify({
        kind: "signedIn",
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
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "server-token",
    runtime: { proxy: createProxyRuntime(fetchMock) },
  });

  const resultPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(true);
  const result = await resultPromise;

  expect(result.kind).toBe("signedIn");
  expect(convex.setAuth).toHaveBeenCalledTimes(2);

  const latestFetchAccessToken = convex.setAuth.mock.calls[1]?.[0] as
    | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
    | undefined;
  expect(latestFetchAccessToken).toBeDefined();
  expect(await latestFetchAccessToken!({ forceRefreshToken: false })).toBe("fresh-token");

  expect(fetchMock).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "auth:signIn",
    }),
    "/api/auth",
  );

  auth.destroy();
});

test("server token starts authenticated without loading handshake", () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "server-token",
    runtime: {
      proxy: createProxyRuntime(async () => {
        throw new Error("should not fetch with seeded token");
      }),
    },
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
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(
            JSON.stringify({
              kind: "signedIn",
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
    },
  });

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
  expect(result.kind).toBe("signedIn");

  auth.destroy();
});

test("proxy signIn tolerates transient auth false before confirmation", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(
            JSON.stringify({
              kind: "signedIn",
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
    },
  });

  const signInPromise = auth.signIn("password", {
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
  expect(result.kind).toBe("signedIn");

  auth.destroy();
});

test("proxy signIn times out after rejection signal with no later confirmation", async () => {
  vi.useFakeTimers();
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(
            JSON.stringify({
              kind: "signedIn",
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
    },
  });

  const signInPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await Promise.resolve();
  await Promise.resolve();
  convex.triggerAuthChange(false);

  // eslint-disable-next-line jest/valid-expect -- rejection handler must be registered before advancing timers
  const rejection = expect(signInPromise).rejects.toSatisfy((error: unknown) => {
    return error instanceof ConvexError && error.data?.code === "AUTH_HANDSHAKE_TIMEOUT";
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
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(
            JSON.stringify({
              kind: "signedIn",
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
    },
  });

  const signInPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  // eslint-disable-next-line jest/valid-expect -- rejection handler must be registered before advancing timers
  const rejection2 = expect(signInPromise).rejects.toSatisfy((error: unknown) => {
    return error instanceof ConvexError && error.data?.code === "AUTH_HANDSHAKE_TIMEOUT";
  });
  await vi.advanceTimersByTimeAsync(5001);
  await rejection2;

  auth.destroy();
  vi.useRealTimers();
});

test("proxy refresh does not re-register Convex auth", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(
            JSON.stringify({
              kind: "signedIn",
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
    },
  });

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
  let attempts = 0;
  const fetchMock = vi.fn(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(
      JSON.stringify({
        kind: "signedIn",
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
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: { proxy: createProxyRuntime(fetchMock) },
  });

  const fetchAccessToken = convex.setAuth.mock.calls[0]?.[0] as
    | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
    | undefined;
  expect(fetchAccessToken).toBeDefined();

  const refreshedToken = await fetchAccessToken!({ forceRefreshToken: true });
  expect(refreshedToken).toBe("fresh-token");
  expect(fetchMock).toHaveBeenCalledTimes(3);

  auth.destroy();
});

test("proxy client can call protected mutation immediately after signIn", async () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "existing-token",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(
            JSON.stringify({
              kind: "signedIn",
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
    },
  });

  const signInPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  convex.triggerAuthChange(true);

  const signInResult = await signInPromise;
  expect(signInResult.kind).toBe("signedIn");
  await expect(convex.protectedMutation()).resolves.toEqual({ ok: true });

  auth.destroy();
});

test("proxy mode requires an injected proxy runtime", () => {
  const convex = createConvexMock();

  expect(() =>
    client({
      convex,
      proxyPath: "/api/auth",
    }),
  ).toThrow(/runtime\.proxy/);
});

test("browser client preserves proxy defaults when runtime is partially overridden", async () => {
  vi.stubGlobal("window", {
    location: { origin: "https://example.com", href: "https://example.com" },
  });

  const convex = createConvexMock();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    expect(url).toBe("https://example.com/api/auth");
    return new Response(
      JSON.stringify({
        kind: "signedIn",
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

  const auth = browserClient({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "server-token",
    runtime: {
      location: {
        get: () => null,
        replace: () => {},
        redirect: () => {},
      },
    },
  });

  const signInPromise = auth.signIn("password", {
    email: "sarah@gmail.com",
    password: "44448888",
    flow: "signIn",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(true);

  await expect(signInPromise).resolves.toMatchObject({ kind: "signedIn" });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  auth.destroy();
});

test("empty SSR token is treated as signed out", () => {
  const convex = createConvexMock();
  const auth = client({
    convex,
    proxyPath: "/api/auth",
    tokenSeed: "",
    runtime: {
      proxy: createProxyRuntime(
        async () =>
          new Response(JSON.stringify({ kind: "signedIn", tokens: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    },
  });

  expect(auth.state.token).toBeNull();
  expect(auth.state.isAuthenticated).toBe(false);

  auth.destroy();
});
