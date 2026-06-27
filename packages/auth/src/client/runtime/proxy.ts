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
  return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
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
