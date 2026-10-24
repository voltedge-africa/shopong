import { defineConfig } from "vite-plus";

const ignorePatterns = [
  "_bmad/**",
  "_bmad-output/**",
  ".agents/**",
  ".claude/**",
  "docs/source/**",
  // Spikes are throwaway evidence with their own lockfile and config (spikes/README.md).
  "spikes/**",
];

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "_bmad/**",
      "_bmad-output/**",
      ".agents/**",
      ".claude/**",
      "spikes/**",
    ],
  },
  fmt: { ignorePatterns },
  lint: {
    ignorePatterns,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
