import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, Stack, ThemeProvider, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette } from "@/constants/colors";
import { MiniPlayer } from "@/components/mini-player";
import { ActionDrawerProvider } from "@/components/action-drawer";
import { PlayerProvider } from "@/providers/player-provider";
import { SessionProvider, useSession } from "@/providers/session-provider";

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.background,
    card: palette.background,
    border: palette.border,
    primary: palette.text,
  },
};

function PersistentMiniPlayer() {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const route = String(segments[segments.length - 1] ?? "");
  if (
    route === "player" ||
    (session.phase !== "ready" && session.phase !== "offline")
  )
    return null;
  const inTabs = String(segments[0]) === "(tabs)";
  return (
    <MiniPlayer
      bottom={inTabs ? 60 + insets.bottom : Math.max(8, insets.bottom)}
    />
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <PlayerProvider>
            <ActionDrawerProvider>
              <ThemeProvider value={theme}>
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: palette.background },
                    animation: "slide_from_right",
                  }}
                >
                  <Stack.Screen name="index" options={{ animation: "fade" }} />
                  <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
                  <Stack.Screen
                    name="player"
                    options={{
                      presentation: "fullScreenModal",
                      animation: "slide_from_bottom",
                      animationDuration: 180,
                      gestureEnabled: true,
                    }}
                  />
                </Stack>
                <PersistentMiniPlayer />
              </ThemeProvider>
            </ActionDrawerProvider>
          </PlayerProvider>
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
