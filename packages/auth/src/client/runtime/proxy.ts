import { ConvexError, type Value } from "convex/values";

const NETWORK_ERROR_PATTERN = /(network|fetch|load failed|failed to fetch)/i;

type ProxyErrorBody = {
  error?: string;
  authError?: unknown;
};

/** @internal */
export function isTransientNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && NETWORK_ERROR_PATTERN.test(error.message || ""))
  );
}

/** @internal */
export function isRetriableProxyRefreshError(error: unknown): boolean {
  if (isTransientNetworkError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const statusMatch = error.message.match(/Proxy request failed:\s*(\d{3})/);
  if (statusMatch === null) {
    return false;
  }
  const statusCode = Number(statusMatch[1]);
  return statusCode >= 500 && statusCode < 600;
}

/** @internal */
export function parseProxyErrorBody(value: unknown): ProxyErrorBody {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const obj = value as Record<string, unknown>;
  return {
    error: typeof obj.error === "string" ? obj.error : undefined,
    authError: obj.authError,
  };
}

/** @internal */
export function createProxyHelpers(args: { proxy: string | undefined }) {
  const { proxy } = args;

  const resolveProxyUrl = () => {
    const origin =
      typeof window !== "undefined" && typeof window.location?.origin === "string"
        ? window.location.origin
        : typeof location !== "undefined" && typeof location.origin === "string"
          ? location.origin
          : null;
    if (origin !== null) {
      return new URL(proxy!, origin).toString();
    }
    try {
      return new URL(proxy!).toString();
    } catch {
      return proxy! as string;
    }
  };

  const isAbsoluteUrl = (value: string) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false as const;
    }
  };

  const proxyFetch = async (body: Record<string, unknown>) => {
    const proxyUrl = resolveProxyUrl();
    if (typeof window === "undefined" && !isAbsoluteUrl(proxyUrl)) {
      throw new Error(
        `Cannot call relative proxy URL \`${proxy!}\` without a browser origin. ` +
          "Pass an absolute proxy URL for server runtimes.",
      );
    }

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = (await response.json()) as Record<string, unknown>;
      } catch {
        errorBody = {};
      }
      if (
        typeof errorBody === "object" &&
        errorBody !== null &&
        "authError" in errorBody &&
        typeof (errorBody as Record<string, unknown>).authError === "object"
      ) {
        throw new ConvexError((errorBody as Record<string, unknown>).authError as Value);
      }
      throw new Error(
        ((errorBody as Record<string, unknown>).error as string) ??
          `Proxy request failed: ${response.status}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Proxy response was not valid JSON");
    }
  };

  return { isAbsoluteUrl, proxyFetch, resolveProxyUrl };
}
