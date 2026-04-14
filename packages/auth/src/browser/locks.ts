import { Effect, Layer, ServiceMap } from "effect";

import { localMutex } from "../client/runtime/mutex";

export class BrowserLocks extends ServiceMap.Service<
  BrowserLocks,
  {
    readonly withKey: <T>(
      key: string,
      callback: () => Promise<T>,
    ) => Effect.Effect<T>;
  }
>()("BrowserLocks") {}

export const BrowserLocksLive = Layer.succeed(BrowserLocks)({
  withKey: <T>(key: string, callback: () => Promise<T>) =>
    Effect.promise(async () => {
      const lockManager =
        typeof navigator === "undefined" ? undefined : navigator.locks;
      return lockManager !== undefined
        ? await lockManager.request(key, callback)
        : await localMutex(key, callback);
    }),
});
