/**
 * Shape of the `"app"` Svelte context provided by the root layout. In SPA mode
 * this replaces the data that used to come from `+layout.server.ts`: auth state
 * from the client, the available providers, and the deployment's site URL.
 */
export type AppContext = {
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly authProviders: { google: boolean };
  readonly siteUrl: string;
};
