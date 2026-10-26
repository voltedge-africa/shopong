// Loaded with `node --import ./src/register.mjs ...`: installs the `.js` to `.ts` resolve hook (ts-resolve.mjs).
import { register } from "node:module";

register(new URL("./ts-resolve.mjs", import.meta.url));
