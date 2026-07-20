import { Tabs } from "expo-router";
import { Home, Library, Search, Settings } from "lucide-react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { layout, palette } from "@/constants/colors";
import { useSession } from "@/providers/session-provider";

function icon(Icon: typeof Home) {
  return function TabBarIcon({
    color,
    size,
  }: {
    color: unknown;
    size: number;
  }) {
    return <Icon color={String(color)} size={size} strokeWidth={2.3} />;
  };
}

export default function TabsLayout() {
  const session = useSession();
  const insets = useSafeAreaInsets();
  if (session.phase !== "ready" && session.phase !== "offline") return null;
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: palette.text,
          tabBarInactiveTintColor: palette.muted,
          tabBarStyle: {
            height: layout.tabBar + insets.bottom,
            backgroundColor: "#000",
            borderTopColor: palette.border,
            paddingTop: 7,
            paddingBottom: Math.max(8, insets.bottom),
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: icon(Home),
            href: session.phase === "offline" ? null : undefined,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarIcon: icon(Search),
            href: session.phase === "offline" ? null : undefined,
          }}
        />
        <Tabs.Screen
          name="library"
          options={{ title: "Library", tabBarIcon: icon(Library) }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: "Settings", tabBarIcon: icon(Settings) }}
        />
      </Tabs>
    </View>
  );
}
