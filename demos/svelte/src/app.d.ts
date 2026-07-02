declare global {
  namespace App {
    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
      cf?: IncomingRequestCfProperties;
    }

    interface PageData {
      convexUrl: string | undefined;
      authProviders: {
        google: boolean;
      };
    }
  }
}

export {};
