// In-memory adapters for every port: deterministic, no network, injectable clock and ids.
// Pure TypeScript, so they also run inside the Shopong app for the scripted tracer (story 1.4).
export * from "./support.js";
export * from "./capability-auth.js";
export * from "./shared-record.js";
export * from "./ledger.js";
export * from "./payments.js";
export * from "./stable-rail.js";
export * from "./ocr.js";
export * from "./decide.js";
export * from "./routing.js";
export * from "./geo.js";
export * from "./agent.js";
export * from "./gen-ui.js";
