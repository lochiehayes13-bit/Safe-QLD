// Metro's defaults with two additions the web build needs.
//
// `wasm` is an asset, not a module: expo-sqlite's web worker imports the
// WebAssembly build of SQLite by path, and without this Metro tries to parse
// it as JavaScript and the web bundle fails outright.
//
// The `.web.ts` shims beside the native modules are picked up by the
// platform-aware resolver Expo already installs; nothing extra is needed for
// them here.
const { getDefaultConfig } = require('expo/metro-config');

const path = require('path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

// The phone's keystore does not exist in a browser. Rather than thread a
// second import through every module that holds a key, the web bundle gets a
// `localStorage` stand-in with the same three functions; the Android and iOS
// bundles are untouched and still use the hardware keystore.
const nativeResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-secure-store') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'src/web/secureStore.ts') };
  }
  return (nativeResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
