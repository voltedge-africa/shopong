import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import type { MiniApp } from "./miniapps";

type Props = {
  app: MiniApp;
  /** Show the green check at the tile's top right. */
  showInstalled?: boolean;
  onPress: () => void;
};

export function MiniAppTile({ app, showInstalled = false, onPress }: Props) {
  const [iconColor, checkColor] = useCSSVariable([
    "--color-foreground",
    "--color-success-solid-foreground",
  ]);
  const installed = showInstalled && app.installed;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={installed ? `${app.title}, installed` : app.title}
      onPress={onPress}
      className="w-1/4 items-center gap-2 py-3"
    >
      <View className="h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card">
        <Ionicons name={app.icon} size={28} color={iconColor as string} />
        {installed ? (
          <View className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-success">
            <Ionicons name="checkmark" size={14} color={checkColor as string} />
          </View>
        ) : null}
      </View>
      <Text size="xs" muted numberOfLines={1}>
        {app.title}
      </Text>
    </Pressable>
  );
}
