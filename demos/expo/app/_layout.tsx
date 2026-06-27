import "react-native-reanimated";

import { DarkTheme, ThemeProvider } from "@react-navigation/native";
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

const ConvexTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.util.accent,
    background: colors.background.primary,
    card: colors.background.secondary,
    text: colors.content.primary,
    border: colors.border.transparent,
    notification: colors.util.accent,
  },
};

export default function RootLayout() {
  const [client, setClient] = React.useState<ReturnType<typeof getClient> | null>(null);

  React.useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setClient(getClient());
    });
    return () => task.cancel();
  }, []);

  if (!client) {
    return (
      <ThemeProvider value={ConvexTheme}>
        <View
          style={{
            flex: 1,
            backgroundColor: ConvexTheme.colors.background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={ConvexTheme.colors.primary} />
          <StatusBar style="light" />
        </View>
      </ThemeProvider>
    );
  }

  return (
    <ConvexProvider client={client}>
      <AppClientProvider client={client}>
        <DemoAuthProvider>
          <ThemeProvider value={ConvexTheme}>
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
            <StatusBar style="light" />
          </ThemeProvider>
        </DemoAuthProvider>
      </AppClientProvider>
    </ConvexProvider>
  );
}
