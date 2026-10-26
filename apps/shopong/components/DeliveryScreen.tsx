// The Delivery mini app's screen (story 7.4). The page shows the map, the route's line and its three sentences; this card
// above it lets the treasurer or a driver plan the route between two registered places. Every member sees the planned
// route. The phone shows the Node's words and place labels only: no coordinate, no address, and no route is computed here.
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Text } from "panelui-native";
import { View } from "react-native";

import { BundleMiniApp } from "./BundleMiniApp";
import { useCommunity } from "../lib/CommunityProvider";
import type { NodePlace } from "../lib/nodeClient";
import { roadLabelOf, routeLoadMessage, type RoutePlace, type RouteScreen } from "../lib/route";

type Props = {
  /** The Metro asset id of the built page. */
  asset: number;
  /** The page's own messages (the demonstration round), used until a planned route is known. */
  messages: readonly unknown[];
};

/** The page's message for the collection points: each a collection stop, with no legs (story 7.3). */
function pointsLoadMessage(points: readonly NodePlace[]) {
  return {
    type: "load" as const,
    map: {
      stops: points.map((point) => ({
        id: point.id,
        name: point.label,
        lat: point.lat,
        lng: point.lng,
        kind: "collection" as const,
        status: "pending" as const,
      })),
      legs: [],
    },
  };
}

export function DeliveryScreen({ asset, messages }: Props) {
  const { placesOf, planRoute, routeScreen, nodePlacesOf } = useCommunity();
  const [places, setPlaces] = useState<readonly RoutePlace[]>([]);
  // The collection points with their coordinates, from the Node (story 7.3). Shown on the page until a route is planned.
  const [points, setPoints] = useState<readonly NodePlace[]>([]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(1);
  const [screen, setScreen] = useState<RouteScreen>({ state: "none" });
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      const [list, planned, onNode] = await Promise.all([
        placesOf(),
        routeScreen(),
        nodePlacesOf(),
      ]);
      if (!current) return;
      setPlaces(list);
      setScreen(planned);
      setPoints(onNode);
    })();
    return () => {
      current = false;
    };
  }, [placesOf, routeScreen, nodePlacesOf]);

  const route = screen.state === "shown" ? screen.route : undefined;
  // With a planned route the page is sent its line and sentences; without one, its own demonstration round.
  // Without a planned route, the page shows the community's collection points when there are some, and its demonstration
  // round when there are none (the demonstration's own points are never mixed with a real community's).
  const pageMessages = useMemo(
    () =>
      route !== undefined
        ? [routeLoadMessage(route)]
        : points.length > 0
          ? [pointsLoadMessage(points)]
          : messages,
    [route, points, messages],
  );

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
