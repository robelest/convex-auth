import { api } from "$convex/_generated/api";
import {
  client as createAuthClient,
  type AuthClient,
} from "@robelest/convex-auth/expo";
import type { AuthState, SignInResult } from "@robelest/convex-auth/client";
import React from "react";

import { getClient } from "./client";

type DemoAuthClient = AuthClient<typeof api.auth>;

type DemoAuthContextValue = {
  auth: DemoAuthClient;
  state: AuthState;
  signIn: (provider: string, params?: Record<string, unknown>) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const DemoAuthContext = React.createContext<DemoAuthContextValue | null>(null);

let authSingleton: DemoAuthClient | null = null;

export function getAuthClient(): DemoAuthClient {
  authSingleton ??= createAuthClient({
    convex: getClient(),
    api: api.auth,
    authSession: {
      redirectUri: "demoexpo://auth",
      scheme: "demoexpo",
    },
  });
  return authSingleton;
}

export function DemoAuthProvider({ children }: { children: React.ReactNode }) {
  const auth = React.useMemo(() => getAuthClient(), []);
  const [state, setState] = React.useState<AuthState>(auth.state);

  React.useEffect(() => {
    const unsubscribe = auth.onChange((next) => {
      setState({ ...next });
    });
    void auth.initialize();
    return unsubscribe;
  }, [auth]);

  const value = React.useMemo<DemoAuthContextValue>(
    () => ({
      auth,
      state,
      signIn: auth.signIn,
      signOut: auth.signOut,
    }),
    [auth, state],
  );

  return <DemoAuthContext.Provider value={value}>{children}</DemoAuthContext.Provider>;
}

export function useDemoAuth() {
  const value = React.useContext(DemoAuthContext);
  if (!value) {
    throw new Error("useDemoAuth must be used within DemoAuthProvider");
  }
  return value;
}
