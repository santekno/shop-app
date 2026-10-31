#!/bin/sh
# Renders the app icon and splash images in this folder from one drawing,
# the GoShop mark: a shopping bag with a "G" cut out of it. app.config.ts
# points at the PNGs; they are committed, so a build needs nothing but them.
# Run it again only when the mark or a colour changes:
#
#   sh assets/brand/render.sh        (from apps/mobile; needs rsvg-convert,
#                                     `brew install librsvg`)
#
# The colours are the roles in src/theme/colors.js: primary (#0b5cad, dark
# #4493f8) for the mark, background (#f6f8fa, dark #0d1117) behind the
# splash. The mark itself is in goshop-mark.svg, drawn on a 1024 × 1024
# canvas with its centre at 512,512.
set -eu
cd "$(dirname "$0")"

# mark <fill> <scale> [background]: the mark in one colour, scaled about
# the centre, on a transparent canvas or on a solid square (for icons that
# must be opaque: the App Store rejects an icon with transparency). The G
# is a hole (a mask), not a second colour, so whatever is behind the mark
# shows through it: the adaptive icon's background layer, the splash
# colour, Android's themed-icon tint.
mark() {
  background=""
  if [ $# -ge 3 ]; then
    background="<rect width='1024' height='1024' fill='$3'/>"
  fi
  cat <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <mask id="g-cut">
      <rect width="1024" height="1024" fill="#fff"/>
      <path d="M582.7 534.3 A100 100 0 1 0 612 605 L530 605" fill="none" stroke="#000" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>
    </mask>
  </defs>
  $background
  <g transform="translate(512 512) scale($2) translate(-512 -512)" fill="$1">
    <path d="M432 404 V364 a80 80 0 0 1 160 0 V404" fill="none" stroke="$1" stroke-width="48" stroke-linecap="round"/>
    <rect x="300" y="384" width="424" height="390" rx="60" mask="url(#g-cut)"/>
  </g>
</svg>
SVG
}

png() {
  rsvg-convert --width 1024 --height 1024 --format png --output "$1"
}

# The canonical drawing, in the brand colour, for anything else that needs it.
mark "#0b5cad" 1 > goshop-mark.svg

# iOS (and the fallback for every platform): white mark on the brand colour,
# edge to edge; iOS rounds the corners itself.
mark "#ffffff" 1.2 "#0b5cad" | png icon.png
# iOS 18 dark icon: the mark in the dark-mode brand colour on transparency,
# which iOS fills with its own dark background.
mark "#4493f8" 1.2 | png icon-dark.png

# Android adaptive icon: the foreground layer only. app.config.ts gives the
# background layer as a colour. The launcher masks both to its shape (a
# circle, a squircle …) and may move them, so the mark stays inside the
# middle 66 % (the "safe zone"); scale 1 keeps it within a 640 px circle.
# Android 13 themed icons use the same file as a monochrome mask.
mark "#ffffff" 1 | png adaptive-icon.png

# Splash: the mark alone; the plugin centres it on the background colour.
mark "#0b5cad" 1 | png splash-icon.png
mark "#4493f8" 1 | png splash-icon-dark.png
