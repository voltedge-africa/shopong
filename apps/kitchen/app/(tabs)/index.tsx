import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { miniApps } from "../../components/miniapps";

export default function Home() {
  const router = useRouter();
  const iconColor = useCSSVariable("--color-foreground") as string;

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView contentContainerClassName="p-6 gap-6">
          <Text accessibilityRole="header" size="3xl" weight="bold">
            Home
          </Text>
          <View className="flex-row flex-wrap">
            {miniApps.map((app) => (
              <Pressable
                key={app.id}
                accessibilityRole="button"
                accessibilityLabel={app.title}
                onPress={() => router.push({ pathname: "/miniapp/[id]", params: { id: app.id } })}
                className="w-1/4 items-center gap-2 py-3"
              >
                <View className="h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card">
                  <Ionicons name={app.icon} size={28} color={iconColor} />
                </View>
                <Text size="xs" muted numberOfLines={1}>
                  {app.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
