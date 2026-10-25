import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// One self-contained page: scripts and styles are inlined afterwards by scripts/inline.mjs.
export default defineConfig({
  resolve: { alias: { assert: fileURLToPath(new URL("./src/shims/assert.ts", import.meta.url)) } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 30_000,
    rollupOptions: { output: { codeSplitting: false } },
  },
});
