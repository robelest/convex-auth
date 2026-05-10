import { ConvexReactClient } from "convex/react";
import Constants from "expo-constants";
import React from "react";

const CONVEX_URL =
  process.env.EXPO_PUBLIC_CONVEX_URL ??
  ((Constants.expoConfig?.extra?.convexUrl as string | undefined) ?? undefined);

type AppClient = ConvexReactClient;

let clientSingleton: AppClient | null = null;

const AppClientContext = React.createContext<AppClient | null>(null);

export function getClient(): AppClient {
  if (!CONVEX_URL) {
    throw new Error(
      "Missing EXPO_PUBLIC_CONVEX_URL. Point the Expo demo at your active Convex deployment before starting the app.",
    );
  }
  clientSingleton ??= new ConvexReactClient(CONVEX_URL);
  return clientSingleton;
}

export function AppClientProvider({
  client,
  children,
}: {
  client: AppClient;
  children: React.ReactNode;
}) {
  return (
    <AppClientContext.Provider value={client}>{children}</AppClientContext.Provider>
  );
}

export function useAppClient(): AppClient {
  const client = React.useContext(AppClientContext);
  if (!client) {
    throw new Error("useAppClient must be used within AppClientProvider");
  }
  return client;
}
