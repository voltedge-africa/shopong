/**
 * How the delivery map looks, in Kepler's saved-config format. Points are coloured by status; the
 * route is drawn as one line per leg. `dataId` ties each layer to a dataset from `datasets.ts`.
 */

// Ordinal scales take their domain in sorted order: "delivered" before "pending".
const STATUS_COLORS = ["#34d399", "#f59e0b"];

const colorRange = (colors: string[]) => ({
  name: "Status",
  type: "qualitative",
  category: "Custom",
  colors,
});

export const LAYER_CONFIG = {
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
            color: [148, 163, 184],
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
              colorRange: colorRange(["#94a3b8"]),
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
              strokeColor: [14, 17, 22],
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
                color: [226, 232, 240],
                size: 16,
                offset: [0, 0],
                anchor: "middle",
                alignment: "bottom",
                outlineWidth: 3,
                outlineColor: [11, 15, 20, 255],
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

/** Only the map: no layer, filter or style panels, and none of the toolbar except the legend. */
export const MAP_CONTROLS = {
  visibleLayers: { show: false },
  mapLegend: { show: true, active: false },
  toggle3d: { show: false },
  splitMap: { show: false },
  mapDraw: { show: false },
  mapLocale: { show: false },
};
