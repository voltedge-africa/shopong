import type { AppMessage, DeliveryMap } from "./protocol";

/**
 * Demo data: a round from a collection point in Clermont, Durban, two drop-offs done and two to go.
 * The points sit on residential streets in OpenStreetMap, picked so the demo looks right; they are
 * not real addresses, and no real business is used as a stop. The legs are straight lines between
 * stops, not routes along the roads.
 */
export const deliveryMap: DeliveryMap = {
  stops: [
    {
      id: "depot",
      name: "Collection point",
      lat: -29.7939,
      lng: 30.90433,
      kind: "collection",
      status: "delivered",
    },
    {
      id: "a",
      name: "Drop-off A",
      lat: -29.79644,
      lng: 30.91274,
      kind: "dropoff",
      status: "delivered",
    },
    {
      id: "b",
      name: "Drop-off B",
      lat: -29.7886,
      lng: 30.91198,
      kind: "dropoff",
      status: "delivered",
    },
    {
      id: "c",
      name: "Drop-off C",
      lat: -29.79213,
      lng: 30.89545,
      kind: "dropoff",
      status: "pending",
    },
    {
      id: "d",
      name: "Drop-off D",
      lat: -29.79801,
      lng: 30.89757,
      kind: "dropoff",
      status: "pending",
    },
  ],
  legs: [
    { from: "depot", to: "a" },
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
  ],
};

/** What the map page is sent once it reports that it is ready. */
export const deliveryMessages: readonly AppMessage[] = [{ type: "load", map: deliveryMap }];
