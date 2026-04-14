import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient";
import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore";
import * as BrowserStream from "@effect/platform-browser/BrowserStream";
import { Effect, Fiber, Stream } from "effect";
import * as KeyValueStore from "effect/unstable/persistence/KeyValueStore";

import type { ClientRuntime } from "../client/core/types";
import { BrowserLocks, BrowserLocksLive } from "./locks";
import { BrowserNavigation, BrowserNavigationLive } from "./navigation";

const browserStorage = {
  async getItem(key: string) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        return yield* store.get(key);
      }).pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage)),
    );
  },
  async setItem(key: string, value: string) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        yield* store.set(key, value);
      }).pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage)),
    );
  },
  async removeItem(key: string) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        yield* store.remove(key);
      }).pipe(Effect.provide(BrowserKeyValueStore.layerLocalStorage)),
    );
  },
};

/** @internal */
export function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** @internal */
export function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type BrowserGlobals = typeof globalThis & {
  __convexAuthStorageListeners?: Record<string, () => void>;
};

/** @internal */
export function getStorageListenerRegistry(): Record<string, () => void> {
  const globals: BrowserGlobals = globalThis;
  if (globals.__convexAuthStorageListeners === undefined) {
    globals.__convexAuthStorageListeners = {};
  }
  return globals.__convexAuthStorageListeners;
}

/** @internal */
export function createBrowserRuntime(): ClientRuntime {
  return {
    environment: typeof window === "undefined" ? "server" : "client",
    storage: typeof window === "undefined" ? null : browserStorage,
    location: {
      get: () =>
        Effect.runSync(
          BrowserNavigation.useSync((navigation) => navigation.get()).pipe(
            Effect.provide(BrowserNavigationLive),
          ),
        ),
      replace: (url) =>
        Effect.runPromise(
          BrowserNavigation.use((navigation) => navigation.replace(url)).pipe(
            Effect.provide(BrowserNavigationLive),
          ),
        ),
      redirect: (url) =>
        Effect.runPromise(
          BrowserNavigation.use((navigation) => navigation.redirect(url)).pipe(
            Effect.provide(BrowserNavigationLive),
          ),
        ),
    },
    mutex: {
      withKey: (key, callback) =>
        Effect.runPromise(
          BrowserLocks.use((locks) => locks.withKey(key, callback)).pipe(
            Effect.provide(BrowserLocksLive),
          ),
        ),
    },
    proxy: {
      fetch: async (body, proxyPath) => {
        return Effect.runPromise(
          Effect.gen(function* () {
            const fetch = yield* BrowserHttpClient.Fetch;
            return yield* Effect.promise(() =>
              fetch(new URL(proxyPath, window.location.origin), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
              }),
            );
          }).pipe(Effect.provide(BrowserHttpClient.layerFetch)),
        );
      },
    },
    sync: {
      subscribe: (key, callback) => {
        if (typeof window === "undefined") {
          return null;
        }
        const registry = getStorageListenerRegistry();
        const existingSubscription = registry[key];
        if (existingSubscription !== undefined) {
          existingSubscription();
        }
        const fiber = Effect.runFork(
          BrowserStream.fromEventListenerWindow("storage").pipe(
            Stream.runForEach((event: StorageEvent) =>
              event.key !== key
                ? Effect.void
                : Effect.promise(async () => {
                    await callback(event.newValue ?? null);
                  }),
            ),
          ),
        );
        const unsubscribe = () => {
          if (registry[key] === unsubscribe) {
            delete registry[key];
          }
          Effect.runFork(Fiber.interrupt(fiber));
        };
        registry[key] = unsubscribe;
        return unsubscribe;
      },
    },
  };
}
