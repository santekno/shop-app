// Metro bundles the app's JavaScript, as Vite does for apps/admin.
//
// Expo's default config already knows this is a pnpm workspace (since SDK
// 52): it watches the repository root, so a change in packages/shared
// reloads the app, and it follows pnpm's symlinks out of node_modules. The
// watchFolders / nodeModulesPaths / disableHierarchicalLookup lines found in
// older monorepo guides are not needed and should not be added back.
//
// withNativeWind (artikel 05) runs Tailwind on global.css and compiles the
// result into React Native styles for each platform. inlineRem: 16 makes
// 1rem 16 dp, the browser's 16 px, so p-3 is 12 and text-sm is 14 as on the
// web; NativeWind's own default is 14.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

module.exports = withNativeWind(getDefaultConfig(__dirname), {
  input: "./global.css",
  inlineRem: 16,
});
