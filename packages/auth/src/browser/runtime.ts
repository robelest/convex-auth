import type { ClientRuntime } from "../client/core/types";
import { BrowserLocksLive } from "./locks";
import { BrowserNavigationLive } from "./navigation";

const browserStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage may be full or unavailable
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be unavailable
    }
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
      get: () => BrowserNavigationLive.get(),
      replace: (url) => {
        BrowserNavigationLive.replace(url);
        return Promise.resolve();
      },
      redirect: (url) => {
        BrowserNavigationLive.redirect(url);
        return Promise.resolve();
      },
    },
    mutex: {
      withKey: (key, callback) => BrowserLocksLive.withKey(key, callback),
    },
    proxy: {
      fetch: async (body, proxyPath) => {
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
        const existingSubscription = registry[key];
        if (existingSubscription !== undefined) {
          existingSubscription();
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
          if (registry[key] === unsubscribe) {
            delete registry[key];
          }
          controller.abort();
        };
        registry[key] = unsubscribe;
        return unsubscribe;
      },
    },
  };
}
