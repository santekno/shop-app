/**
 * The site's banner. JSX looks like HTML but compiles to function calls,
 * not markup: with "jsx": "react-jsx" (tsconfig.app.json) the build turns
 * <header className="site-header"> into jsx("header", { className: … }),
 * imported for you from react/jsx-runtime. (The older transform called
 * React.createElement and needed `import React` in every file.) So a
 * few rules differ from HTML:
 * - `className`, not `class` (class is a JavaScript keyword);
 * - every tag is closed, including empty ones such as <br />;
 * - a component returns one root element.
 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <h1>GoShop</h1>
      <p className="muted">
        Toko online contoh dari kursus Fullstack Santekno.
      </p>
    </header>
  );
}
