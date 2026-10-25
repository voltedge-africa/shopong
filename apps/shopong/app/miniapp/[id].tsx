import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Text } from "panelui-native";

import { BundleMiniApp } from "../../components/BundleMiniApp";
import { MiniAppView } from "../../components/MiniAppView";
import { NativeMiniApp } from "../../components/NativeMiniApp";
import { miniApps } from "../../components/miniapps";

// One generic activity for every mini app: it looks the app up by id and renders its content,
// a sandboxed web page, a shipped web bundle or a native component.
export default function MiniAppActivity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = miniApps.find((candidate) => candidate.id === id);
  const content = app?.content;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: app?.title ?? "Mini app" }} />
      {content?.kind === "web" ? <MiniAppView source={content.source} /> : null}
      {content?.kind === "native" ? <NativeMiniApp load={content.load} /> : null}
      {content?.kind === "bundle" ? (
        <BundleMiniApp asset={content.asset()} messages={content.messages} />
      ) : null}
      {content === undefined ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text muted>Mini app not found.</Text>
        </View>
      ) : null}
    </View>
  );
}
