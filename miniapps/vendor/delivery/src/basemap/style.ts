import clermont from "./clermont.json";

/** The OpenStreetMap extract written by scripts/fetch-osm.mjs. */
type Layers = Record<"buildings" | "landuse" | "green" | "water" | "roads" | "rail", object>;
const data = clermont as unknown as Layers & {
  attribution: string;
  bbox: [number, number, number, number];
};

export const ATTRIBUTION = data.attribution;

/**
 * A MapLibre style that draws the extract: no tiles, no glyphs, no sprites, so nothing is fetched.
 * Text is left to Kepler's own layers (the stop names), which do not need glyph files.
 */
export const CLERMONT_STYLE = {
  version: 8,
  name: "Clermont, eThekwini (OpenStreetMap)",
  sources: {
    landuse: { type: "geojson", data: data.landuse },
    green: { type: "geojson", data: data.green },
    water: { type: "geojson", data: data.water },
    buildings: { type: "geojson", data: data.buildings },
    roads: { type: "geojson", data: data.roads },
    rail: { type: "geojson", data: data.rail },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0b0f14" } },
    { id: "landuse", type: "fill", source: "landuse", paint: { "fill-color": "#10161d" } },
    { id: "green", type: "fill", source: "green", paint: { "fill-color": "#12251c" } },
    {
      id: "water-area",
      type: "fill",
      source: "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#12304a" },
    },
    {
      id: "water-line",
      type: "line",
      source: "water",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#1d4d73", "line-width": 1.5 },
    },
    {
      id: "buildings",
      type: "fill",
      source: "buildings",
      minzoom: 13,
      paint: { "fill-color": "#1b2430", "fill-outline-color": "#2a3645" },
    },
    {
      id: "rail",
      type: "line",
      source: "rail",
      paint: { "line-color": "#3b4656", "line-width": 1.5, "line-dasharray": [3, 3] },
    },
    {
      id: "roads-minor",
      type: "line",
      source: "roads",
      filter: ["in", ["get", "class"], ["literal", ["service", "living_street", "unclassified"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#2c3745",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 2],
      },
    },
    {
      id: "roads-residential",
      type: "line",
      source: "roads",
      filter: ["==", ["get", "class"], "residential"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#3d4a5b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 3],
      },
    },
    {
      id: "roads-major",
      type: "line",
      source: "roads",
      filter: [
        "!",
        [
          "in",
          ["get", "class"],
          ["literal", ["service", "living_street", "unclassified", "residential"]],
        ],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#64748b",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 5],
      },
    },
  ],
};
