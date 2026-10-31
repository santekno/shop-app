// Babel compiles the app's JavaScript for Metro. Expo's preset is the
// default; this file exists for NativeWind's two additions (artikel 05):
//
// - jsxImportSource: "nativewind" makes every JSX element go through
//   NativeWind's JSX runtime, which turns a `className` prop into `style`
//   on the core components (View, Text, Image, Pressable, ScrollView …);
// - "nativewind/babel" handles the imports that runtime needs.
//
// nativewind/babel adds @babel/plugin-transform-react-jsx without depending
// on it, so package.json lists it: Gradle and Xcode run the release bundle
// with plain `node`, without the NODE_PATH pnpm's shims set (README, artikel 05).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
