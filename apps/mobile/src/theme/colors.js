// GoShop's colours: the roles and values of apps/web/src/index.css, the
// storefront's design tokens, so the app and the website look like one
// shop. Each role has its light value (DEFAULT) and its dark one (dark).
//
// Read in two places, which is why it is plain CommonJS rather than
// TypeScript: tailwind.config.js (run by Node) turns every role into
// classes (bg-card, bg-card-dark, text-muted-foreground …), and code that
// needs a colour as a value rather than a class (the navigation theme in
// src/theme/navigation.ts) imports it. TypeScript reads it too (allowJs).
//
// Named by role, never by hue, as on the web: a role keeps its meaning
// when its value changes.
module.exports = {
  colors: {
    // The screen, and the text on it.
    background: { DEFAULT: "#f6f8fa", dark: "#0d1117" },
    foreground: { DEFAULT: "#1f2328", dark: "#e6edf3" },
    // Panels: the product card.
    card: { DEFAULT: "#ffffff", dark: "#151b23" },
    // The brand colour: main buttons, links, the active tab.
    primary: { DEFAULT: "#0b5cad", dark: "#4493f8" },
    "primary-foreground": { DEFAULT: "#ffffff", dark: "#0d1117" },
    // Quiet surfaces (the photo placeholder) and secondary text.
    muted: { DEFAULT: "#eef1f4", dark: "#212830" },
    "muted-foreground": { DEFAULT: "#59636e", dark: "#9198a1" },
    // A pressed card or control.
    accent: { DEFAULT: "#eef1f4", dark: "#262c36" },
    // Errors and "Stok habis".
    destructive: { DEFAULT: "#b42318", dark: "#ff7b72" },
    "destructive-foreground": { DEFAULT: "#ffffff", dark: "#0d1117" },
    // Lines between things: a card's edge.
    border: { DEFAULT: "#d1d9e0", dark: "#3d444d" },
  },
};
