import type { DeliveryMap, Stop } from "./protocol";

/** The shape `addDataToMap` takes: a dataset is `fields` plus `rows` of values in field order. */
export type KeplerDataset = {
  info: { id: string; label: string };
  data: {
    fields: { name: string; format: string; type: "string" | "real" }[];
    rows: (string | number)[][];
  };
};

const field = (name: string, type: "string" | "real") => ({ name, format: "", type });

/**
 * Two datasets: the stops as points, and the route as one line per leg. Kepler draws a point
 * layer from `lat`/`lng` and a line layer from `lat0`/`lng0`/`lat1`/`lng1`.
 */
export function toKeplerDatasets({ stops, legs }: DeliveryMap): KeplerDataset[] {
  const byId = new Map(stops.map((stop) => [stop.id, stop]));

  const legRows = legs.flatMap((leg) => {
    const from = byId.get(leg.from);
    const to = byId.get(leg.to);
    return from && to ? [[from.name, to.name, from.lat, from.lng, to.lat, to.lng]] : [];
  });

  return [
    {
      info: { id: "stops", label: "Stops" },
      data: {
        fields: [
          field("name", "string"),
          field("kind", "string"),
          field("status", "string"),
          field("lat", "real"),
          field("lng", "real"),
        ],
        rows: stops.map((stop) => [stop.name, stop.kind, stop.status, stop.lat, stop.lng]),
      },
    },
    {
      info: { id: "route", label: "Route" },
      data: {
        fields: [
          field("from", "string"),
          field("to", "string"),
          field("lat0", "real"),
          field("lng0", "real"),
          field("lat1", "real"),
          field("lng1", "real"),
        ],
        rows: legRows,
      },
    },
  ];
}

/**
 * The stops' bounding box as `[lngMin, latMin, lngMax, latMax]`, grown by `ratio` of its size on
 * every side. Kepler fits the map to exactly the box, which leaves the outer stops on the screen edge.
 */
export function paddedBounds(
  stops: readonly Stop[],
  ratio = 0.3,
): [number, number, number, number] {
  const lngs = stops.map((stop) => stop.lng);
  const lats = stops.map((stop) => stop.lat);
  const [lngMin, lngMax] = [Math.min(...lngs), Math.max(...lngs)];
  const [latMin, latMax] = [Math.min(...lats), Math.max(...lats)];
  // A single stop has no extent; give it one so the map does not zoom in to the maximum.
  const lngPad = Math.max((lngMax - lngMin) * ratio, 0.005);
  const latPad = Math.max((latMax - latMin) * ratio, 0.005);
  return [lngMin - lngPad, latMin - latPad, lngMax + lngPad, latMax + latPad];
}
