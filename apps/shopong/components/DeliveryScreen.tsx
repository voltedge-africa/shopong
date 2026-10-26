// The Delivery mini app's screen (story 7.4). The page shows the map, the route's line and its three sentences; this card
// above it lets the treasurer or a driver plan the route between two registered places. Every member sees the planned
// route. The phone shows the Node's words and place labels only: no coordinate, no address, and no route is computed here.
import { useEffect, useState } from "react";
import { Alert, Button, Text } from "panelui-native";
import { View } from "react-native";

import { BundleMiniApp } from "./BundleMiniApp";
import { useCommunity } from "../lib/CommunityProvider";
import { roadLabelOf, routeLoadMessage, type RoutePlace, type RouteScreen } from "../lib/route";

type Props = {
  /** The Metro asset id of the built page. */
  asset: number;
  /** The page's own messages (the demonstration round), used until a planned route is known. */
  messages: readonly unknown[];
};

export function DeliveryScreen({ asset, messages }: Props) {
  const { placesOf, planRoute, routeScreen } = useCommunity();
  const [places, setPlaces] = useState<readonly RoutePlace[]>([]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(1);
  const [screen, setScreen] = useState<RouteScreen>({ state: "none" });
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      const [list, planned] = await Promise.all([placesOf(), routeScreen()]);
      if (!current) return;
      setPlaces(list);
      setScreen(planned);
    })();
    return () => {
      current = false;
    };
  }, [placesOf, routeScreen]);

  const route = screen.state === "shown" ? screen.route : undefined;
  // With a planned route the page is sent its line and sentences; without one, its own demonstration round.
  const pageMessages = route === undefined ? messages : [routeLoadMessage(route)];

  const plan = async () => {
    const origin = places[from];
    const destination = places[to];
    if (origin === undefined || destination === undefined) return;
    setBusy(true);
    setNotice(undefined);
    const planned = await planRoute(origin.id, destination.id);
    setBusy(false);
    if (planned.ok) {
      setScreen({ state: "shown", route: planned.route });
      return;
    }
    setNotice(planned.message);
  };

  const canPlan = places.length >= 2 && from !== to;

  return (
    <View className="flex-1 bg-background">
      <View className="gap-2 border-b border-border p-3">
        {places.length < 2 ? (
          <Text muted>Two places must be registered before a route can be planned.</Text>
        ) : (
          <>
            <Button variant="outline" onPress={() => setFrom((i) => (i + 1) % places.length)}>
              {`From: ${places[from]?.label ?? ""}`}
            </Button>
            <Button variant="outline" onPress={() => setTo((i) => (i + 1) % places.length)}>
              {`To: ${places[to]?.label ?? ""}`}
            </Button>
            <Button fullWidth disabled={busy || !canPlan} onPress={() => void plan()}>
              {busy ? "Planning the route" : "Plan route"}
            </Button>
          </>
        )}
        {notice === undefined ? null : <Text muted>{notice}</Text>}
        {screen.state === "unreachable" || screen.state === "refused" ? (
          <Alert variant="destructive">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{screen.message}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        {route === undefined ? null : <Text muted>{roadLabelOf(route)}</Text>}
      </View>
      <View className="flex-1">
        <BundleMiniApp asset={asset} messages={pageMessages} />
      </View>
    </View>
  );
}
