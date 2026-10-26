// Applies the viewer's saved theme before the page is painted.
//
// index.html loads this file with a plain <script src> in <head>: no
// `type="module"`, no `defer`, so the browser runs it before it reads
// <body>. By the first paint <html> already carries data-theme, and a
// reload never flashes the light page before turning dark.
//
// Why a file and not an inline <script> in index.html: the CSP the web
// container sends (apps/web/Caddyfile) is `script-src 'self'`, which
// refuses inline code. Allowing it would mean 'unsafe-inline' (which also
// lets an injected script run) or a hash of the script in the CSP, kept in
// step with every edit. A file from our own origin needs neither.
//
// It is plain JavaScript that Vite copies as it is (public/): it cannot
// import src/features/theme/theme.ts, so the key and the accepted values
// are repeated here. Keep them the same in both files.
(function () {
  try {
    var theme = window.localStorage.getItem("goshop:theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // Storage blocked (a privacy setting, a sandboxed frame): follow the
    // device's preference, which the CSS does without the attribute.
  }
})();
