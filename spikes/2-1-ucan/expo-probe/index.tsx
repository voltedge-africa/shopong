import "./polyfills";
import { registerRootComponent } from "expo";
import { App } from "./App";
import { polyfills } from "./polyfills";
registerRootComponent(() => <App polyfills={polyfills} />);
