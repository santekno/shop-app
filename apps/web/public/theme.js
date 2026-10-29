// Applies the viewer's saved theme before the page is painted.
//
// The root layout (src/app/layout.tsx) loads this file with a plain
// <script src> in <head>: no `type="module"`, no `defer`, so the browser
// runs it before it reads <body>. By the first paint <html> already
// carries data-theme, and a reload never flashes the light page before
// turning dark.
//
// Why a file and not inline code: in Bab 7–10 the CSP was
// `script-src 'self'`, which refuses inline code, and allowing it would
// have meant 'unsafe-inline' (which also lets an injected script run) or
// a hash kept in step with every edit. Since Bab 11 artikel 08 the CSP
// (src/proxy.ts) carries a nonce per request, which an inline script
// could use; the file stays, because the browser keeps it in its cache
// (a revalidation answers 304) instead of receiving it again inside every
// page's HTML.
//
// It is plain JavaScript served as it is (public/): it cannot
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
