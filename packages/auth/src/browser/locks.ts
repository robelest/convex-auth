import { localMutex } from "../client/runtime/mutex";

export interface BrowserLocksService {
  readonly withKey: <T>(key: string, callback: () => Promise<T>) => Promise<T>;
}

export const BrowserLocksLive: BrowserLocksService = {
  withKey: async <T>(key: string, callback: () => Promise<T>): Promise<T> => {
    const lockManager =
      typeof navigator === "undefined" ? undefined : navigator.locks;
    return lockManager !== undefined
      ? await lockManager.request(key, callback)
      : await localMutex(key, callback);
  },
};
