import { Effect, Layer, ServiceMap } from "effect";

export class BrowserNavigation extends ServiceMap.Service<
  BrowserNavigation,
  {
    readonly get: () => URL | null;
    readonly replace: (url: string) => Effect.Effect<void>;
    readonly redirect: (url: URL) => Effect.Effect<void>;
  }
>()("BrowserNavigation") {}

export const BrowserNavigationLive = Layer.succeed(BrowserNavigation)({
  get: () =>
    typeof window === "undefined" ? null : new URL(window.location.href),
  replace: (url: string) =>
    Effect.sync(() => {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", url);
      }
    }),
  redirect: (url: URL) =>
    Effect.sync(() => {
      if (typeof window !== "undefined") {
        window.location.href = url.toString();
      }
    }),
});
