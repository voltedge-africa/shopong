/**
 * How the delivery map looks, in Kepler's saved-config format. Points are coloured by status; the
 * route is drawn as one line per leg. `dataId` ties each layer to a dataset from `datasets.ts`.
 */

import type { MapMode } from "./protocol";

// Ordinal scales take their domain in sorted order: "delivered" before "pending".
const STATUS_COLORS = ["#34d399", "#f59e0b"];

/** The inks that must change with the theme, as Kepler wants them (RGB or RGB+alpha arrays). */
const INK = {
  dark: {
    route: "#94a3b8",
    routeRgb: [148, 163, 184],
    planned: "#2dd4bf",
    plannedRgb: [45, 212, 191],
    stopStroke: [14, 17, 22],
    stopText: [226, 232, 240],
    stopTextOutline: [11, 15, 20, 255],
  },
  light: {
    route: "#64748b",
    routeRgb: [100, 116, 139],
    planned: "#0d9488",
    plannedRgb: [13, 148, 136],
    stopStroke: [255, 255, 255],
    stopText: [15, 23, 42],
    stopTextOutline: [255, 255, 255, 255],
  },
} as const;

const colorRange = (colors: string[]) => ({
  name: "Status",
  type: "qualitative",
  category: "Custom",
  colors,
});

export function makeLayerConfig(mode: MapMode, withPlanned = false) {
  const ink = INK[mode];
  return {
    version: "v1",
    config: {
      visState: {
        // Tapping a stop names it and gives its status.
        interactionConfig: {
          tooltip: {
            enabled: true,
            compareMode: false,
            compareType: "absolute",
            fieldsToShow: {
              stops: [
                { name: "name", format: null },
                { name: "kind", format: null },
                { name: "status", format: null },
              ],
            },
          },
          brush: { enabled: false, size: 0.5 },
          geocoder: { enabled: false },
          coordinate: { enabled: false },
        },
        layers: [
          {
            id: "route-layer",
            type: "line",
            config: {
              dataId: "route",
              label: "Route",
              color: ink.routeRgb,
              columns: {
                lat0: "lat0",
                lng0: "lng0",
                lat1: "lat1",
                lng1: "lng1",
                alt0: null,
                alt1: null,
              },
              isVisible: true,
              visConfig: {
                opacity: 0.7,
                thickness: 3,
                colorRange: colorRange([ink.route]),
                sizeRange: [0, 10],
                targetColor: null,
                elevationScale: 1,
              },
              hidden: false,
              textLabel: [],
            },
            visualChannels: {
              colorField: null,
              colorScale: "quantile",
              sizeField: null,
              sizeScale: "linear",
            },
          },
          ...(withPlanned
            ? [
                {
                  id: "planned-route-layer",
                  type: "line",
                  config: {
                    dataId: "planned-route",
                    label: "Planned route",
                    color: ink.plannedRgb,
                    columns: {
                      lat0: "lat0",
                      lng0: "lng0",
                      lat1: "lat1",
                      lng1: "lng1",
                      alt0: null,
                      alt1: null,
                    },
                    isVisible: true,
                    visConfig: {
                      opacity: 0.9,
                      thickness: 4,
                      colorRange: colorRange([ink.planned]),
                      sizeRange: [0, 10],
                      targetColor: null,
                      elevationScale: 1,
                    },
                    hidden: false,
                    textLabel: [],
                  },
                  visualChannels: {
                    colorField: null,
                    colorScale: "quantile",
                    sizeField: null,
                    sizeScale: "linear",
                  },
                },
              ]
            : []),
          {
            id: "stops-layer",
            type: "point",
            config: {
              dataId: "stops",
              label: "Stops",
              color: [52, 211, 153],
              columns: { lat: "lat", lng: "lng", altitude: null },
              isVisible: true,
              visConfig: {
                radius: 14,
                fixedRadius: false,
                opacity: 0.95,
                outline: true,
                thickness: 2,
                strokeColor: ink.stopStroke,
                colorRange: colorRange(STATUS_COLORS),
                strokeColorRange: colorRange(STATUS_COLORS),
                radiusRange: [0, 50],
                filled: true,
              },
              hidden: false,
              // The stop's name under its dot; drawn by Kepler on a canvas, so no font files are needed.
              textLabel: [
                {
                  field: { name: "name", type: "string" },
                  color: ink.stopText,
                  size: 16,
                  offset: [0, 0],
                  anchor: "middle",
                  alignment: "bottom",
                  outlineWidth: 3,
                  outlineColor: ink.stopTextOutline,
                  background: false,
                },
              ],
            },
            visualChannels: {
              colorField: { name: "status", type: "string" },
              colorScale: "ordinal",
              strokeColorField: null,
              strokeColorScale: "quantile",
              sizeField: null,
              sizeScale: "linear",
            },
          },
        ],
      },
    },
  };
}

/** Only the map: no layer, filter or style panels, and none of the toolbar except the legend. */
export const MAP_CONTROLS = {
  visibleLayers: { show: false },
  mapLegend: { show: true, active: false },
  toggle3d: { show: false },
  splitMap: { show: false },
  mapDraw: { show: false },
  mapLocale: { show: false },
};
