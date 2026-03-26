import { Fx } from "@robelest/fx";
import { ConvexError, type Value } from "convex/values";

const NETWORK_ERROR_PATTERN = /(network|fetch|load failed|failed to fetch)/i;

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
export function createProxyHelpers(args: { proxy: string | undefined }) {
  const { proxy } = args;

  const resolveProxyUrl = () => {
    const origin =
      typeof window !== "undefined" &&
      typeof window.location?.origin === "string"
        ? window.location.origin
        : typeof location !== "undefined" && typeof location.origin === "string"
          ? location.origin
          : null;
    if (origin !== null) {
      return new URL(proxy!, origin).toString();
    }
    return Fx.run(
      Fx.from({
        ok: () => new URL(proxy!).toString(),
        err: () => proxy! as string,
      }).pipe(Fx.recover((fallback) => Fx.succeed(fallback))),
    );
  };

  const isAbsoluteUrl = (value: string) => {
    return Fx.run(
      Fx.from({
        ok: () => {
          new URL(value);
          return true;
        },
        err: () => false as const,
      }).pipe(Fx.recover((v) => Fx.succeed(v))),
    );
  };

  const proxyFetch = async (body: Record<string, unknown>) => {
    const proxyUrl = await resolveProxyUrl();
    if (typeof window === "undefined" && !(await isAbsoluteUrl(proxyUrl))) {
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
      const errorBody = await Fx.run(
        Fx.from({
          ok: () => response.json() as Promise<Record<string, unknown>>,
          err: () => ({}) as Record<string, unknown>,
        }).pipe(Fx.recover((fallback) => Fx.succeed(fallback))),
      );
      if (
        typeof errorBody === "object" &&
        errorBody !== null &&
        "authError" in errorBody &&
        typeof (errorBody as Record<string, unknown>).authError === "object"
      ) {
        throw new ConvexError(
          (errorBody as Record<string, unknown>).authError as Value,
        );
      }
      throw new Error(
        ((errorBody as Record<string, unknown>).error as string) ??
          `Proxy request failed: ${response.status}`,
      );
    }
    return Fx.run(
      Fx.from({
        ok: () => response.json(),
        err: () => new Error("Proxy response was not valid JSON"),
      }).pipe(Fx.recover((e) => Fx.fatal(e))),
    );
  };

  return { isAbsoluteUrl, proxyFetch, resolveProxyUrl };
}
