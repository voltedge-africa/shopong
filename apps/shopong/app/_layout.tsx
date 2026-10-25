import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PanelUIProvider } from "panelui-native";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";

import { AuthProvider, useAuth } from "../lib/auth";

function AppStack() {
  const { status } = useAuth();
  const [background, foreground] = useCSSVariable(["--color-background", "--color-foreground"]);

  if (status === "loading") return <View className="flex-1 bg-background" />;

  const unlocked = status === "unlocked";

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: background as string },
        headerTintColor: foreground as string,
        headerShadowVisible: false,
      }}
    >
      <Stack.Protected guard={unlocked}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="miniapp/[id]" />
        <Stack.Screen name="thinking" />
      </Stack.Protected>
      <Stack.Protected guard={!unlocked}>
        <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <PanelUIProvider>
      <StatusBar style="auto" />
      <AuthProvider>
        <AppStack />
      </AuthProvider>
    </PanelUIProvider>
  );
}
