import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import { Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { timeAgo, type Notification } from "../lib/notifications";
import type { MiniApp } from "./miniapps";

type Props = {
  notification: Notification;
  /** The mini app that sent it, for its icon. */
  app: MiniApp | undefined;
  now: number;
  onPress: () => void;
};

export function NotificationRow({ notification, app, now, onPress }: Props) {
  const iconColor = useCSSVariable("--color-foreground") as string;
  const when = timeAgo(notification.at, now);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${notification.title}, ${notification.read ? "" : "unread, "}${notification.body}, ${when}`}
      onPress={onPress}
      className="flex-row items-start gap-3 rounded-2xl py-3"
    >
      <View className="h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
        {app ? <Ionicons name={app.icon} size={22} color={iconColor} /> : null}
      </View>
      <View className="flex-1 gap-0.5">
        <Text weight={notification.read ? "medium" : "bold"}>{notification.title}</Text>
        <Text size="sm" muted numberOfLines={2}>
          {notification.body}
        </Text>
        <Text size="xs" muted>
          {when}
        </Text>
      </View>
      {notification.read ? null : <View className="mt-2 h-2.5 w-2.5 rounded-full bg-primary" />}
    </Pressable>
  );
}
