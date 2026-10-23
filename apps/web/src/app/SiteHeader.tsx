interface SiteHeaderProps {
  /** Called when the buyer clicks the brand, to go back to the catalog. */
  onHome: () => void;
}

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
export function SiteHeader({ onHome }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <h1>
        <button type="button" className="brand" onClick={onHome}>
          GoShop
        </button>
      </h1>
      <p className="muted">
        Toko online contoh dari kursus Fullstack Santekno.
      </p>
    </header>
  );
}
