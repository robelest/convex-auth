import type { ClientRuntime } from "../client/core/types";
import { BrowserLocksLive } from "./locks";
import { BrowserNavigationLive } from "./navigation";

const browserStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
  },
};

/** @internal */
export function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @internal */
export function base64urlDecode(str: string): Uint8Array {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type BrowserGlobals = typeof globalThis & {
  __convexAuthStorageListeners?: Record<string, Set<() => void>>;
};

/** @internal */
export function getStorageListenerRegistry(): Record<string, Set<() => void>> {
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
      get: () => BrowserNavigationLive.get(),
      replace: (url) => {
        BrowserNavigationLive.replace(url);
        return Promise.resolve();
      },
    },
    oauth: {
      open: (url) => {
        BrowserNavigationLive.open(url);
        return Promise.resolve();
      },
    },
    mutex: {
      withKey: (key, callback) => BrowserLocksLive.withKey(key, callback),
    },
    proxy: {
      fetch: async (body, proxyPath) => {
        if (typeof window === "undefined" || window.location?.origin === undefined) {
          throw new Error("Browser proxy fetch is unavailable outside the browser runtime.");
        }
        return fetch(new URL(proxyPath, window.location.origin), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
      },
    },
    sync: {
      subscribe: (key, callback) => {
        if (typeof window === "undefined") {
          return null;
        }
        const registry = getStorageListenerRegistry();
        if (registry[key] === undefined) {
          registry[key] = new Set();
        }

        const controller = new AbortController();
        window.addEventListener(
          "storage",
          (event: StorageEvent) => {
            if (event.key !== key) return;
            void callback(event.newValue ?? null);
          },
          { signal: controller.signal },
        );

        const unsubscribe = () => {
          registry[key]?.delete(unsubscribe);
          if (registry[key]?.size === 0) {
            delete registry[key];
          }
          controller.abort();
        };
        registry[key].add(unsubscribe);
        return unsubscribe;
      },
    },
  };
}
