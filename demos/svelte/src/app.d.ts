declare global {
  namespace App {
    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }

    interface Locals {
      authToken: string | null;
      isAuthenticated: boolean;
    }

    interface PageData {
      convexUrl: string | undefined;
      authProviders: {
        google: boolean;
      };
      auth: {
        token: string | null;
        isAuthenticated: boolean;
      };
    }
  }
}

export {};
