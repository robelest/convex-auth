import "react-native-reanimated";

import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { ConvexProvider } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, InteractionManager, View } from "react-native";

import { AuthGate } from "@/src/AuthGate";
import { DemoAuthProvider } from "@/src/auth";
import { AppClientProvider, getClient } from "@/src/client";
import { OverlayGuardProvider } from "@/src/overlays";
import { ProjectSelectionProvider } from "@/src/selection";
import { colors } from "@/src/theme";

const WarmTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent[500],
    background: colors.warm[50],
    card: colors.white,
    text: colors.warm[900],
    border: colors.warm[300],
    notification: colors.accent[500],
  },
};

export default function RootLayout() {
  const [client, setClient] = React.useState<ReturnType<
    typeof getClient
  > | null>(null);

  React.useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setClient(getClient());
    });
    return () => task.cancel();
  }, []);

  if (!client) {
    return (
      <ThemeProvider value={WarmTheme}>
        <View
          style={{
            flex: 1,
            backgroundColor: WarmTheme.colors.background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={WarmTheme.colors.primary} />
          <StatusBar style="dark" />
        </View>
      </ThemeProvider>
    );
  }

  return (
    <ConvexProvider client={client}>
      <AppClientProvider client={client}>
        <DemoAuthProvider>
          <ThemeProvider value={WarmTheme}>
            <AuthGate>
              <ProjectSelectionProvider>
                <OverlayGuardProvider>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen
                      name="project-picker"
                      options={{
                        presentation: "formSheet",
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: [0.5, 0.9],
                      }}
                    />
                    <Stack.Screen
                      name="project/[id]"
                      options={{
                        presentation: "formSheet",
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: [0.7, 1.0],
                      }}
                    />
                    <Stack.Screen
                      name="issue/[id]"
                      options={{
                        presentation: "formSheet",
                        sheetGrabberVisible: true,
                        sheetAllowedDetents: [0.85, 1.0],
                      }}
                    />
                  </Stack>
                </OverlayGuardProvider>
              </ProjectSelectionProvider>
            </AuthGate>
            <StatusBar style="dark" />
          </ThemeProvider>
        </DemoAuthProvider>
      </AppClientProvider>
    </ConvexProvider>
  );
}
