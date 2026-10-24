// Synthetic community-event data: members (coarsened lat/lon), orders, pledges, deliveries.
// Deterministic (seeded) so every run, every version sees identical rows.

export interface Dataset {
  members: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  pledges: Record<string, unknown>[];
  deliveries: Record<string, unknown>[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ITEMS = ["maize meal 10kg", "sugar 2kg", "cooking oil 750ml", "rice 5kg", "bread flour 5kg", "tinned pilchards"];
// Collection points (coarsened to 2 decimals, around Soweto / Johannesburg).
export const COLLECTION_POINTS = [
  { id: "cp1", name: "Orlando Hall", lat: -26.24, lon: 27.91 },
  { id: "cp2", name: "Diepkloof Spaza", lat: -26.25, lon: 27.94 },
  { id: "cp3", name: "Meadowlands Church", lat: -26.21, lon: 27.88 },
  { id: "cp4", name: "Dobsonville Depot", lat: -26.18, lon: 27.85 },
];

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/** `total` is the approximate total number of rows across the four tables. */
export function generate(total: number, seed = 42): Dataset {
  const rnd = mulberry32(seed);
  const nMembers = Math.max(10, Math.floor(total * 0.05));
  const nOrders = Math.floor(total * 0.4);
  const nPledges = Math.floor(total * 0.4);
  const nDeliveries = Math.max(1, total - nMembers - nOrders - nPledges);
  const members: Dataset["members"] = [];
  for (let i = 0; i < nMembers; i++) {
    // coarsened to a 0.01 degree grid (~1.1 km): the only location that ever enters a dataset
    const lat = Math.round((-26.3 + rnd() * 0.17) * 100) / 100;
    const lon = Math.round((27.8 + rnd() * 0.2) * 100) / 100;
    members.push({
      member_id: i,
      // keyed commitment stand-in (hex), never a phone number
      commitment: Math.floor(rnd() * 2 ** 48).toString(16).padStart(12, "0"),
      lat,
      lon,
      joined_ms: T0 + Math.floor(rnd() * 90 * DAY),
    });
  }
  const orders: Dataset["orders"] = [];
  for (let i = 0; i < nOrders; i++) {
    const item = ITEMS[Math.floor(rnd() * ITEMS.length)];
    const ts = T0 + Math.floor(rnd() * 365 * DAY);
    orders.push({
      order_id: i,
      member_id: Math.floor(rnd() * nMembers),
      item,
      qty: 1 + Math.floor(rnd() * 5),
      // price drifts with time, so price history is meaningful
      price_cents: Math.round(2000 + ITEMS.indexOf(item) * 900 + ((ts - T0) / DAY) * 2 + rnd() * 300),
      ts_ms: ts,
    });
  }
  const pledges: Dataset["pledges"] = [];
  for (let i = 0; i < nPledges; i++) {
    const cycle = Math.floor(rnd() * 12);
    pledges.push({
      pledge_id: i,
      member_id: Math.floor(rnd() * nMembers),
      cycle,
      amount_cents: 20000 + Math.floor(rnd() * 5) * 5000,
      paid: rnd() > 0.15,
      ts_ms: T0 + cycle * 30 * DAY + Math.floor(rnd() * 10 * DAY),
    });
  }
  const deliveries: Dataset["deliveries"] = [];
  for (let i = 0; i < nDeliveries; i++) {
    const dispatched = T0 + Math.floor(rnd() * 365 * DAY);
    const cp = COLLECTION_POINTS[Math.floor(rnd() * COLLECTION_POINTS.length)];
    deliveries.push({
      delivery_id: i,
      order_id: Math.floor(rnd() * nOrders),
      collection_point: cp.id,
      dispatched_ms: dispatched,
      delivered_ms: dispatched + Math.floor((2 + rnd() * 30) * 3_600_000),
      status: rnd() > 0.05 ? "delivered" : "failed",
    });
  }
  return { members, orders, pledges, deliveries };
}

/** Synthetic suburb polygons (GeoJSON FeatureCollection) around the collection points. */
export function suburbGeoJSON() {
  const box = (lon: number, lat: number, d: number) => [
    [
      [lon - d, lat - d],
      [lon + d, lat - d],
      [lon + d, lat + d],
      [lon - d, lat + d],
      [lon - d, lat - d],
    ],
  ];
  return {
    type: "FeatureCollection",
    features: COLLECTION_POINTS.map((p) => ({
      type: "Feature",
      properties: { name: p.name + " catchment", cp: p.id },
      geometry: { type: "Polygon", coordinates: box(p.lon, p.lat, 0.025) },
    })),
  };
}
