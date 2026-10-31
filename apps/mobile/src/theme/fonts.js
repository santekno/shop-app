// GoShop's typeface in the app: Inter, by Rasmus Andersson, under the SIL
// Open Font License 1.1 (assets/fonts/OFL.txt). The storefront uses the
// device's system font (apps/web/src/index.css); Inter is the open font
// closest to it in spirit, a neutral sans-serif drawn for screens, and
// it looks the same on Android and iOS, which the system fonts (Roboto,
// San Francisco) do not.
//
// Plain CommonJS, like colors.js, because it is read by Node as well as by
// the app: app.config.ts embeds the files in the native projects (the
// expo-font config plugin), tailwind.config.js makes `font-sans` this
// family, and src/theme/navigation.ts gives it to the headers and the tab
// bar.
//
// One family name, four files. The weights are chosen with fontWeight
// (`font-semibold`), as on the web: on iOS the files share the family name
// "Inter" inside them; on Android the config plugin groups them into one
// font-family resource with a weight per file. Only the weights the app
// uses are shipped: each file is about 410 KB.
module.exports = {
  fonts: {
    sans: "Inter",
    faces: [
      { weight: 400, path: "./assets/fonts/Inter-Regular.ttf" },
      { weight: 500, path: "./assets/fonts/Inter-Medium.ttf" },
      { weight: 600, path: "./assets/fonts/Inter-SemiBold.ttf" },
      { weight: 700, path: "./assets/fonts/Inter-Bold.ttf" },
    ],
  },
};
