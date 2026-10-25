// Metro for the probe
const path = require("node:path");
const fs = require("node:fs");
const { getDefaultConfig } = require("expo/metro-config");

const spike = path.resolve(__dirname, "..");
const repo = path.resolve(spike, "../..");
const config = getDefaultConfig(__dirname);

const aliases = {
  "@shopong/ports": path.join(repo, "packages/ports/src/index.ts"),
  "@shopong/ports-contract": path.join(repo, "packages/ports-contract/src/index.ts"),
  "vite-plus/test": path.join(spike, "src/probe/expect-shim.ts"),
};

config.watchFolders = [spike, path.join(repo, "packages/ports"), path.join(repo, "packages/ports-contract")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules"), path.join(spike, "node_modules")];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (aliases[moduleName]) return { type: "sourceFile", filePath: aliases[moduleName] };
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const candidate = path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.js$/, ".ts"));
    if (!context.originModulePath.includes("node_modules") && fs.existsSync(candidate)) {
      return { type: "sourceFile", filePath: candidate };
    }
  }
  // Handle node: protocol
  if (moduleName.startsWith('node:')) {
    moduleName = moduleName.slice(5);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  crypto: require.resolve('expo-crypto'),
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
};

module.exports = config;
