// Babel compiles the app's JavaScript for Metro. Expo's preset is the
// default; this file exists for NativeWind's two additions (artikel 05):
//
// - jsxImportSource: "nativewind" makes every JSX element go through
//   NativeWind's JSX runtime, which turns a `className` prop into `style`
//   on the core components (View, Text, Image, Pressable, ScrollView …);
// - "nativewind/babel" handles the imports that runtime needs.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
