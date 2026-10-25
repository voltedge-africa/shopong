const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// Mini apps that ship as a built web page (the Kepler.gl map) are bundled as assets.
config.resolver.assetExts.push("html");

// Four changes to how Metro finds modules.
//
// 1. The workspace packages (@shopong/ports, @shopong/events, @shopong/adapters-memory) are written the
//    way TypeScript's NodeNext mode wants: `import "./common.js"` for a file called `common.ts`. Metro
//    looks for a real .js file, so when there is none it tries the .ts and .tsx next to it.
// 2. OpenUI's renderer draws `div`s, which a phone does not have. On a phone it gets a JSX runtime that
//    says a `div` is a `View` (see lib/openuiJsxRuntime.ts).
// 3. On the web, OpenUI's default entry mounts a developer overlay (it imports @openuidev/devtools)
//    when running in development. The React Native entry is the same renderer without it, so the web
//    build uses that one too.
// 4. The iso-ucan adapter's `iso-base` runs `import crypto from "crypto"` and reads `crypto.webcrypto`.
//    Neither Hermes nor Metro has Node's `crypto`, so it gets a stand-in that exposes the global one
//    (lib/cryptoShim.js; lib/cryptoPolyfills.ts fills in what Hermes lacks on it).
const cryptoShim = path.join(__dirname, "lib/cryptoShim.js");
const openuiNativeEntry = path.join(
  path.dirname(require.resolve("@openuidev/react-lang")),
  "index.native.mjs",
);

const resolveWithTypeScript = (context, moduleName, platform) => {
  if (moduleName === "crypto" || moduleName === "node:crypto") {
    return { type: "sourceFile", filePath: cryptoShim };
  }
  if (platform === "web" && moduleName === "@openuidev/react-lang") {
    return { type: "sourceFile", filePath: openuiNativeEntry };
  }
  if (
    platform !== "web" &&
    moduleName === "react/jsx-runtime" &&
    /[\\/]@openuidev[\\/]react-lang[\\/]/.test(context.originModulePath)
  ) {
    return { type: "sourceFile", filePath: path.join(__dirname, "lib/openuiJsxRuntime.ts") };
  }
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (!moduleName.startsWith(".") || !moduleName.endsWith(".js")) throw error;
    const stem = moduleName.slice(0, -".js".length);
    for (const extension of [".ts", ".tsx"]) {
      try {
        return context.resolveRequest(context, stem + extension, platform);
      } catch {
        // Try the next extension, then report the first failure.
      }
    }
    throw error;
  }
};
config.resolver.resolveRequest = resolveWithTypeScript;

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
