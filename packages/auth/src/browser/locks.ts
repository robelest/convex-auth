import { localMutex } from "../client/runtime/mutex";

interface BrowserLocksService {
  readonly withKey: <T>(key: string, callback: () => Promise<T>) => Promise<T>;
}

export const BrowserLocksLive: BrowserLocksService = {
  withKey: async <T>(key: string, callback: () => Promise<T>): Promise<T> => {
    const lockManager = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (lockManager === undefined) {
      return await localMutex(key, callback);
    }
    try {
      return await lockManager.request(key, callback);
    } catch (err) {
      console.warn("[auth] navigator.locks.request failed; falling back to localMutex", {
        key,
        err,
      });
      return await localMutex(key, callback);
    }
  },
};
