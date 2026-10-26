import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Text } from "panelui-native";

import { BundleMiniApp } from "../../components/BundleMiniApp";
import { DeliveryScreen } from "../../components/DeliveryScreen";
import { MiniAppView } from "../../components/MiniAppView";
import { NativeMiniApp } from "../../components/NativeMiniApp";
import { OrdersHostProvider } from "../../components/OrdersHost";
import { useAllMiniApps } from "../../components/publishedMiniApps";

// One generic activity for every mini app: it looks the app up by id and renders its content,
// a sandboxed web page, a shipped web bundle or a native component.
export default function MiniAppActivity() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const apps = useAllMiniApps();
  const app = apps.find((candidate) => candidate.id === id);
  const content = app?.content;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: app?.title ?? "Mini app" }} />
      {content?.kind === "web" ? <MiniAppView source={content.source} /> : null}
      {content?.kind === "native" && app?.id === "orders" ? (
        // Orders reads and writes this phone's community, so it gets the community's host.
        <OrdersHostProvider>
          <NativeMiniApp load={content.load} />
        </OrdersHostProvider>
      ) : null}
      {content?.kind === "native" && app?.id !== "orders" ? (
        <NativeMiniApp load={content.load} />
      ) : null}
      {content?.kind === "bundle" && app?.id === "delivery" ? (
        // Delivery plans and shows a route for this community, so it gets the community's host (story 7.4).
        <DeliveryScreen asset={content.asset()} messages={content.messages} />
      ) : null}
      {content?.kind === "bundle" && app?.id !== "delivery" ? (
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
