// Metro needs one tweak for the workspace packages: they are TypeScript that imports its
// siblings the NodeNext way (`./canonical.js` for `canonical.ts`), which tsc, Vite and Node
// understand and Metro does not. If a relative `.js` import is not found, try it without the
// extension so Metro finds the `.ts` file. Real `.js` files still win because they are tried first.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
