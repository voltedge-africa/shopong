// Downloads the OpenStreetMap data for the area the Delivery map shows (roads, buildings, water,
// green areas) and writes it as one compact JSON file, src/basemap/clermont.json. Run it by hand (`node scripts/fetch-osm.mjs`) to refresh the
// data; the build only reads the file, so building needs no network.
//
// The data is © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
import { writeFileSync } from "node:fs";

// Clermont, eThekwini (Durban). OSM has only a point for it, so the area is our own box around it.
const BBOX = { south: -29.808, west: 30.889, north: -29.778, east: 30.921 };

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "shopong-dev (phahlamoja08@gmail.com)";
const box = `(${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east})`;

async function overpass(query) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: `[out:json][timeout:120];${query}` }),
  });
  if (!response.ok)
    throw new Error(`Overpass ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).elements;
}

// Five decimal places is about a metre, which is plenty at street level and keeps the file small.
const round = (n) => Math.round(n * 1e5) / 1e5;
const coords = (way) => way.geometry.map((p) => [round(p.lon), round(p.lat)]);
const isClosed = (c) => c.length > 3 && c[0][0] === c.at(-1)[0] && c[0][1] === c.at(-1)[1];

const polygons = (ways, properties = () => ({})) =>
  ways.flatMap((way) => {
    const c = coords(way);
    return isClosed(c)
      ? [
          {
            type: "Feature",
            properties: properties(way),
            geometry: { type: "Polygon", coordinates: [c] },
          },
        ]
      : [];
  });

const lines = (ways, properties = () => ({})) =>
  ways.map((way) => ({
    type: "Feature",
    properties: properties(way),
    geometry: { type: "LineString", coordinates: coords(way) },
  }));

const collection = (features) => ({ type: "FeatureCollection", features });

const ways = (filter) =>
  overpass(`way${filter}${box};out geom;`).then((e) => e.filter((x) => x.type === "way"));
const pause = () => new Promise((resolve) => setTimeout(resolve, 2000)); // be kind to the public server

console.log("buildings…");
const buildings = await ways('["building"]');
await pause();
console.log("roads…");
const roads = await ways(
  '["highway"]["highway"!~"^(footway|path|steps|pedestrian|cycleway|track|bridleway|corridor|proposed|construction|platform)$"]',
);
await pause();
console.log("water…");
const water = [
  ...(await ways('["natural"="water"]')),
  ...(await ways('["waterway"~"^(river|stream|canal|drain)$"]')),
];
await pause();
console.log("green and land use…");
const green = [
  ...(await ways('["leisure"~"^(park|pitch|garden|playground|sports_centre|golf_course)$"]')),
  ...(await ways('["landuse"~"^(grass|forest|recreation_ground|cemetery|meadow|village_green)$"]')),
  ...(await ways('["natural"~"^(wood|scrub|grassland)$"]')),
];
await pause();
const landuse = await ways('["landuse"~"^(residential|commercial|industrial|retail)$"]');
await pause();
console.log("rail…");
const rail = await ways('["railway"="rail"]');

const out = {
  attribution: "© OpenStreetMap contributors (ODbL)",
  fetchedAt: new Date().toISOString().slice(0, 10),
  bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
  buildings: collection(polygons(buildings)),
  landuse: collection(polygons(landuse, (w) => ({ use: w.tags.landuse }))),
  green: collection(polygons(green)),
  water: collection([
    ...polygons(water.filter((w) => w.tags.natural === "water")),
    ...lines(water.filter((w) => w.tags.waterway)),
  ]),
  roads: collection(lines(roads, (w) => ({ class: w.tags.highway }))),
  rail: collection(lines(rail)),
};

const text = JSON.stringify(out);
writeFileSync(new URL("../src/basemap/clermont.json", import.meta.url), text);
console.log(
  `wrote src/basemap/clermont.json: ${(text.length / 1024 / 1024).toFixed(2)} MB — ` +
    `${out.buildings.features.length} buildings, ${out.roads.features.length} roads, ` +
    `${out.water.features.length} water, ${out.green.features.length} green`,
);
