import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, Chip, Text } from "panelui-native";

import { NotificationRow } from "../../components/NotificationRow";
import { TabScreen } from "../../components/TabScreen";
import { miniApps } from "../../components/miniapps";
import {
  demoNotifications,
  filterNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "../../lib/notifications";

export default function Notifications() {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [items, setItems] = useState(() => demoNotifications(now));
  const [showUnread, setShowUnread] = useState(true);
  const [showRead, setShowRead] = useState(true);
  const unread = unreadCount(items);
  const visible = filterNotifications(items, { showRead, showUnread });

  return (
    <TabScreen>
      <ScrollView contentContainerClassName="gap-4 p-6">
        <View className="flex-row items-center justify-between gap-4">
          <Text accessibilityRole="header" size="3xl" weight="bold">
            Notifications
          </Text>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" onPress={() => setItems(markAllRead)}>
              Mark all read
            </Button>
          ) : null}
        </View>
        <Text size="sm" muted>
          Demo notifications: nothing sends real ones yet.
        </Text>
        <View className="flex-row gap-2">
          <Chip selected={showUnread} onPress={() => setShowUnread((on) => !on)}>
            {`Unread (${unread})`}
          </Chip>
          <Chip selected={showRead} onPress={() => setShowRead((on) => !on)}>
            {`Read (${items.length - unread})`}
          </Chip>
        </View>
        {visible.length === 0 ? (
          <Text muted className="py-8 text-center">
            {showRead || showUnread
              ? "Nothing here."
              : "Turn on Unread or Read to see notifications."}
          </Text>
        ) : null}
        <View>
          {visible.map((item) => (
            <NotificationRow
              key={item.id}
              notification={item}
              app={miniApps.find((app) => app.id === item.appId)}
              now={now}
              onPress={() => {
                setItems((current) => markRead(current, item.id));
                router.push({ pathname: "/miniapp/[id]", params: { id: item.appId } });
              }}
            />
          ))}
        </View>
      </ScrollView>
    </TabScreen>
  );
}
