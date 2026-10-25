import { addDataToMap, fitBounds, mapStyleChange } from "@kepler.gl/actions";
import { KeplerGl } from "@kepler.gl/components";
import { enhanceReduxMiddleware, keplerGlReducer } from "@kepler.gl/reducers";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import {
  applyMiddleware,
  combineReducers,
  compose,
  legacy_createStore as createStore,
} from "redux";

import { paddedBounds, toKeplerDatasets } from "./datasets";
import { makeLayerConfig, MAP_CONTROLS } from "./mapConfig";
import { ATTRIBUTION, makeClermontStyle } from "./basemap/style";
import { parseAppMessage, type DeliveryMap, type MapMode, type PageMessage } from "./protocol";

const MAP_ID = "delivery";

// Kepler's type asks for every section of a saved config (filters, interaction settings, ...) but
// accepts one with only the layers, which is all this page needs.
type SavedConfig = NonNullable<Parameters<typeof addDataToMap>[0]["config"]>;
const makeConfig = (mode: MapMode) => makeLayerConfig(mode) as unknown as SavedConfig;

// Kepler fetches its icon list from a third-party server when it starts. Only the icon layer uses
// it, and this page makes no outside requests, so that one fetch gets an empty list instead.
const ICONS_URL = "https://studio-public-data.foursquare.com/statics/keplergl/icons/svg-icons.json";
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) =>
  String(input instanceof Request ? input.url : input) === ICONS_URL
    ? Promise.resolve(Response.json({ svgIcons: [] }))
    : realFetch(input, init);

// Both themes live in the reducer from the start; a theme message picks between them with
// mapStyleChange. The page starts dark; the app says which theme it wants once the page is ready.
const MAP_STYLES = {
  "offline-dark": {
    id: "offline-dark",
    label: "Clermont (night)",
    url: "",
    style: makeClermontStyle("dark"),
    layerGroups: [],
  },
  "offline-light": {
    id: "offline-light",
    label: "Clermont (day)",
    url: "",
    style: makeClermontStyle("light"),
    layerGroups: [],
  },
};

const reducers = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    // Kepler opens its "Add Data To Map" modal until a dataset arrives, which flashes on every start
    // while the page waits for the app's `load` message, and the side panel with "Add Data" shows
    // until then too. This page is read-only from the first frame: no modal, no panel.
    uiState: { mapControls: MAP_CONTROLS, currentModal: null, readOnly: true },
    mapStyle: {
      styleType: "offline-dark",
      mapStyles: MAP_STYLES,
    },
  }),
});

const store = createStore(reducers, {}, compose(applyMiddleware(...enhanceReduxMiddleware([]))));

// Inside the app's WebView; in a plain browser (during development) there is nobody to tell.
const toApp = (message: PageMessage) => {
  const bridge = (window as { ReactNativeWebView?: { postMessage: (text: string) => void } })
    .ReactNativeWebView;
  const text = JSON.stringify(message);
  if (bridge) bridge.postMessage(text);
  else window.parent.postMessage(text, "*");
};

function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

function App() {
  const { width, height } = useWindowSize();
  const [mode, setMode] = useState<MapMode>("dark");
  // The last map the app sent, kept so a later theme change can re-dress the layers drawn with it.
  const [map, setMap] = useState<DeliveryMap | null>(null);
  // The message handler is registered once; it reads the current mode through this ref.
  const modeRef = useRef<MapMode>("dark");
  modeRef.current = mode;

  const showMap = (map: DeliveryMap, mode: MapMode) => {
    store.dispatch(
      addDataToMap({
        datasets: toKeplerDatasets(map),
        options: { centerMap: false, readOnly: true },
        config: makeConfig(mode),
      }) as never,
    );
    store.dispatch(fitBounds(paddedBounds(map.stops)) as never);
  };

  useEffect(() => {
    const onMessage = (event: Event) => {
      const message = parseAppMessage((event as MessageEvent).data);
      if (message === undefined) return;
      if (message.type === "theme") {
        setMode(message.mode);
        return;
      }
      setMap(message.map);
      showMap(message.map, modeRef.current);
    };
    // React Native's WebView delivers on `document` on Android and on `window` on iOS.
    window.addEventListener("message", onMessage);
    document.addEventListener("message", onMessage);
    window.addEventListener("error", (event) => toApp({ type: "error", message: event.message }));
    toApp({ type: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("message", onMessage);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the page registers once and hears everything after
  }, []);

  // A theme change while the map is already drawn re-dresses the layers without re-fitting the view.
  useEffect(() => {
    store.dispatch(mapStyleChange(`offline-${mode}`) as never);
    if (map !== null) showMap(map, mode);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `map` is the trigger's payload, not its dep
  }, [mode]);

  return (
    <>
      {/* Kepler's types say `object`, but the component also takes the named themes of
          @kepler.gl/styles and picks Kepler's own light UI for "light"; the default is its dark UI. */}
      <KeplerGl
        id={MAP_ID}
        width={width}
        height={height}
        mapboxApiAccessToken=""
        theme={mode === "light" ? "light" : undefined}
      />
      <div
        style={{
          position: "fixed",
          left: 8,
          top: 6,
          padding: "1px 6px",
          borderRadius: 4,
          background: mode === "light" ? "rgba(255,255,255,0.75)" : "rgba(11,15,20,0.75)",
          color: mode === "light" ? "#475569" : "#94a3b8",
          font: "11px system-ui, sans-serif",
          pointerEvents: "none",
        }}
      >
        {ATTRIBUTION}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <Provider store={store}>
    <App />
  </Provider>,
);
