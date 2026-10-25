import { addDataToMap, fitBounds } from "@kepler.gl/actions";
import { KeplerGl } from "@kepler.gl/components";
import { enhanceReduxMiddleware, keplerGlReducer } from "@kepler.gl/reducers";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import {
  applyMiddleware,
  combineReducers,
  compose,
  legacy_createStore as createStore,
} from "redux";

import { paddedBounds, toKeplerDatasets } from "./datasets";
import { LAYER_CONFIG, MAP_CONTROLS } from "./mapConfig";
import { ATTRIBUTION, CLERMONT_STYLE } from "./basemap/style";
import { parseAppMessage, type PageMessage } from "./protocol";

const MAP_ID = "delivery";

// Kepler's type asks for every section of a saved config (filters, interaction settings, ...) but
// accepts one with only the layers, which is all this page needs.
type SavedConfig = NonNullable<Parameters<typeof addDataToMap>[0]["config"]>;
const layerConfig = LAYER_CONFIG as unknown as SavedConfig;

// Kepler fetches its icon list from a third-party server when it starts. Only the icon layer uses
// it, and this page makes no outside requests, so that one fetch gets an empty list instead.
const ICONS_URL = "https://studio-public-data.foursquare.com/statics/keplergl/icons/svg-icons.json";
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) =>
  String(input instanceof Request ? input.url : input) === ICONS_URL
    ? Promise.resolve(Response.json({ svgIcons: [] }))
    : realFetch(input, init);

const reducers = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: { mapControls: MAP_CONTROLS },
    mapStyle: {
      styleType: "offline",
      mapStyles: {
        offline: {
          id: "offline",
          label: "Clermont",
          url: "",
          style: CLERMONT_STYLE,
          layerGroups: [],
        },
      },
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

  useEffect(() => {
    const onMessage = (event: Event) => {
      const message = parseAppMessage((event as MessageEvent).data);
      if (message === undefined) return;
      store.dispatch(
        addDataToMap({
          datasets: toKeplerDatasets(message.map),
          options: { centerMap: false, readOnly: true },
          config: layerConfig,
        }) as never,
      );
      store.dispatch(fitBounds(paddedBounds(message.map.stops)) as never);
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
  }, []);

  return (
    <>
      <KeplerGl id={MAP_ID} width={width} height={height} mapboxApiAccessToken="" />
      <div
        style={{
          position: "fixed",
          left: 8,
          top: 6,
          padding: "1px 6px",
          borderRadius: 4,
          background: "rgba(11,15,20,0.75)",
          color: "#94a3b8",
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
