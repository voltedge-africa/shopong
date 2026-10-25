import { defineConfig } from "vite-plus";

// DUCKDB_ALIAS selects which installed @duckdb/duckdb-wasm version the app is built against
// (the package.json holds several versions under aliases for the version matrix).
const alias = process.env.DUCKDB_ALIAS ?? "duckdb-1.32.0";
// ARROW_SHIM=1 swaps apache-arrow's eval-based `createIsValidFunction` for a CSP-safe one.
const shim = process.env.ARROW_SHIM === "1";

export default defineConfig({
  resolve: {
    alias: { "@duckdb/duckdb-wasm": `${process.cwd()}/node_modules/${alias}` },
  },
  plugins: shim
    ? [
        {
          name: "arrow-valid-no-eval",
          enforce: "pre",
          resolveId(source, importer) {
            if (importer?.includes("apache-arrow") && /(^|\/)valid\.mjs$/.test(source)) {
              return `${process.cwd()}/scripts/arrow-valid-shim.mjs`;
            }
          },
        },
      ]
    : [],
  build: { target: "es2022", outDir: process.env.OUT_DIR ?? "dist", emptyOutDir: true },
  // bundles live in public/duckdb (copied by scripts/copy-bundles.mjs) and are served as-is
});
