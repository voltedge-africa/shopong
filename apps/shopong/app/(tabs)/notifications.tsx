import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Button, Chip, Text } from "panelui-native";

import { NotificationRow } from "../../components/NotificationRow";
import { TabScreen } from "../../components/TabScreen";
import { miniApps } from "../../components/miniapps";
import { useCommunity } from "../../lib/CommunityProvider";
import {
  deliveryNotificationsOf,
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
  const { plannedDeliveries, placesOf } = useCommunity();

  // Each planned delivery on the record is an entry in every member's list (story 8.6). Read on the phone, not pushed.
  // An entry keeps its read state when the record is read again.
  useEffect(() => {
    let current = true;
    void (async () => {
      const [plans, places] = await Promise.all([plannedDeliveries(), placesOf()]);
      if (!current || plans.length === 0) return;
      const labels = new Map(places.map((place) => [place.id, place.label]));
      const entries = deliveryNotificationsOf({
        deliveries: plans,
        placeLabel: (id) => labels.get(id),
      });
      setItems((previous) => {
        const readIds = new Set(previous.filter((item) => item.read).map((item) => item.id));
        const fresh = entries.map((entry) =>
          readIds.has(entry.id) ? { ...entry, read: true } : entry,
        );
        const ids = new Set(fresh.map((entry) => entry.id));
        return [...fresh, ...previous.filter((item) => !ids.has(item.id))];
      });
    })();
    return () => {
      current = false;
    };
  }, [plannedDeliveries, placesOf]);
  const [showUnread, setShowUnread] = useState(true);
  const unread = unreadCount(items);
  const visible = filterNotifications(items, { showRead: true, showUnread });

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
        <View className="flex-row gap-2">
          <Chip selected={showUnread} onPress={() => setShowUnread((on) => !on)}>
            {`Unread (${unread})`}
          </Chip>
        </View>
        {visible.length === 0 ? (
          <Text muted className="py-8 text-center">
            Nothing here.
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
