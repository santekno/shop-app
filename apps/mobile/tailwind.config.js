// Tailwind's configuration, read by NativeWind (artikel 05). NativeWind 4
// runs Tailwind CSS v3, configured in JavaScript; apps/web and apps/admin
// are on Tailwind v4, configured in CSS (@theme in src/index.css). The
// class names are the same; where the theme is written differs.
const { hairlineWidth, platformSelect } = require("nativewind/theme");
const { colors } = require("./src/theme/colors");
const { fonts } = require("./src/theme/fonts");

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Every file that may contain a class name. Tailwind scans them as text
  // and generates only the classes it finds, so a class built at run time
  // ("bg-" + name) is never generated: write class names out in full.
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  // dark: follows the device's appearance setting (NativeWind's default,
  // written out): Android's dark theme, iOS's Dark Mode.
  darkMode: "media",
  theme: {
    extend: {
      // The storefront's colour roles: bg-card, text-muted-foreground …,
      // each with a -dark twin (bg-card-dark) for the dark: variant.
      colors,
      // Under extend, because NativeWind's preset sets its own font-sans
      // and font-mono there, and an extend in this file is applied after
      // the preset's. A phone takes one family name, not a CSS stack, and
      // it must be a font the app embeds or the OS has. Nothing is
      // inherited from a View, so every Text says `font-sans`; the weight
      // classes (`font-semibold`) pick the file (artikel 11).
      fontFamily: {
        sans: [fonts.sans],
        // The OS's monospace font: "monospace" is a name only Android
        // knows; iOS calls its own Menlo.
        mono: platformSelect({ ios: "Menlo", android: "monospace" }),
      },
      // border-hairline, border-b-hairline …: StyleSheet.hairlineWidth,
      // the thinnest line the screen can draw (one physical pixel), for
      // the dividers between rows.
      borderWidth: {
        hairline: hairlineWidth(),
      },
    },
  },
  plugins: [],
};
