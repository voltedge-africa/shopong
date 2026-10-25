import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { Text } from "panelui-native";

import { MiniAppTile } from "../../components/MiniAppTile";
import { TabScreen } from "../../components/TabScreen";
import { useHomeMiniApps } from "../../components/publishedMiniApps";

export default function Home() {
  const router = useRouter();
  const apps = useHomeMiniApps();

  return (
    <TabScreen>
      <ScrollView contentContainerClassName="p-6 gap-6">
        <Text accessibilityRole="header" size="3xl" weight="bold">
          Home
        </Text>
        <View className="flex-row flex-wrap">
          {apps.map((app) => (
            <MiniAppTile
              key={app.id}
              app={app}
              onPress={() => router.push({ pathname: "/miniapp/[id]", params: { id: app.id } })}
            />
          ))}
        </View>
      </ScrollView>
    </TabScreen>
  );
}
