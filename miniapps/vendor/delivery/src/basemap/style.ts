import clermont from "./clermont.json";
import type { MapMode } from "../protocol";

/** The OpenStreetMap extract written by scripts/fetch-osm.mjs. */
type Layers = Record<"buildings" | "landuse" | "green" | "water" | "roads" | "rail", object>;
const data = clermont as unknown as Layers & {
  attribution: string;
  bbox: [number, number, number, number];
};

export const ATTRIBUTION = data.attribution;

/**
 * The paints both styles share: geometry, filters and widths stay fixed
 * across themes; only the colours change with the mode.
 */
const LAYER_IDS = [
  "landuse",
  "green",
  "water-area",
  "water-line",
  "buildings",
  "rail",
  "roads-minor",
  "roads-residential",
  "roads-major",
];

/** One colour per shared layer id, plus the background and the building outline. */
type Palette = {
  background: string;
  buildingOutline: string;
} & Record<(typeof LAYER_IDS)[number], string>;

/** Night: the palette the page shipped with first. */
const DARK: Palette = {
  background: "#0b0f14",
  buildingOutline: "#2a3645",
  landuse: "#10161d",
  green: "#12251c",
  "water-area": "#12304a",
  "water-line": "#1d4d73",
  buildings: "#1b2430",
  rail: "#3b4656",
  "roads-minor": "#2c3745",
  "roads-residential": "#3d4a5b",
  "roads-major": "#64748b",
};

/** Day: land in light greys, roads lighter than the land, water in soft blue. */
const LIGHT: Palette = {
  background: "#f1f1ee",
  buildingOutline: "#c9c9c2",
  landuse: "#e9e9e3",
  green: "#d4e3c9",
  "water-area": "#a5c1e0",
  "water-line": "#8bb0d6",
  buildings: "#dfdfda",
  rail: "#b0b0aa",
  "roads-minor": "#e6e6e0",
  "roads-residential": "#f3f3ef",
  "roads-major": "#fbfbf8",
};

/**
 * A MapLibre style that draws the extract: no tiles, no glyphs, no sprites, so nothing is fetched.
 * Text is left to Kepler's own layers (the stop names), which do not need glyph files.
 */
export function makeClermontStyle(mode: MapMode) {
  const paint = mode === "light" ? LIGHT : DARK;
  return {
    version: 8,
    name: `Clermont, eThekwini (OpenStreetMap, ${mode})`,
    sources: {
      landuse: { type: "geojson", data: data.landuse },
      green: { type: "geojson", data: data.green },
      water: { type: "geojson", data: data.water },
      buildings: { type: "geojson", data: data.buildings },
      roads: { type: "geojson", data: data.roads },
      rail: { type: "geojson", data: data.rail },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": paint.background } },
      { id: "landuse", type: "fill", source: "landuse", paint: { "fill-color": paint.landuse } },
      { id: "green", type: "fill", source: "green", paint: { "fill-color": paint.green } },
      {
        id: "water-area",
        type: "fill",
        source: "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": paint["water-area"] },
      },
      {
        id: "water-line",
        type: "line",
        source: "water",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": paint["water-line"], "line-width": 1.5 },
      },
      {
        id: "buildings",
        type: "fill",
        source: "buildings",
        minzoom: 13,
        paint: { "fill-color": paint.buildings, "fill-outline-color": paint.buildingOutline },
      },
      {
        id: "rail",
        type: "line",
        source: "rail",
        paint: { "line-color": paint.rail, "line-width": 1.5, "line-dasharray": [3, 3] },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "roads",
        filter: ["in", ["get", "class"], ["literal", ["service", "living_street", "unclassified"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": paint["roads-minor"],
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
          "line-color": paint["roads-residential"],
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
          "line-color": paint["roads-major"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 5],
        },
      },
    ],
  };
}
