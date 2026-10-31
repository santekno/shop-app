// Tailwind's configuration, read by NativeWind (artikel 05). NativeWind 4
// runs Tailwind CSS v3, configured in JavaScript; apps/web and apps/admin
// are on Tailwind v4, configured in CSS (@theme in src/index.css). The
// class names are the same; where the theme is written differs.
const { colors } = require("./src/theme/colors");

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
    },
  },
  plugins: [],
};
