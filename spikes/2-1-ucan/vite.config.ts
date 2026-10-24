// Spike-local config. The repo's real port and contract sources are aliased in by path, so
// the spike runs the same contract suite as `@shopong/adapters-memory` without joining the
// pnpm workspace. `vite-plus/test` is pinned to this package's copy so the contract's
// `describe`/`expect` and the runner are one instance.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const repo = fileURLToPath(new URL("../../", import.meta.url));

export const aliases = [
  { find: "@shopong/ports-contract", replacement: `${repo}packages/ports-contract/src/index.ts` },
  { find: "@shopong/ports", replacement: `${repo}packages/ports/src/index.ts` },
];

export default defineConfig({
  resolve: {
    alias: [
      ...aliases,
      { find: /^vite-plus\/test$/, replacement: fileURLToPath(import.meta.resolve("vite-plus/test")) },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "expo-probe/**"],
  },
});
