// Metro bundles the app's JavaScript, as Vite does for apps/admin.
//
// Expo's default config already knows this is a pnpm workspace (since SDK
// 52): it watches the repository root, so a change in packages/shared
// reloads the app, and it follows pnpm's symlinks out of node_modules. The
// watchFolders / nodeModulesPaths / disableHierarchicalLookup lines found in
// older monorepo guides are not needed and should not be added back.
//
// The file exists so there is one place to wrap the config later (NativeWind
// in artikel 05 does exactly that).
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
