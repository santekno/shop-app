import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonLd, serializeJsonLd } from "./JsonLd.tsx";

const BREAKOUT = "</script><script>alert(1)</script>";

describe("serializeJsonLd", () => {
  it("escapes <, > and & so the data cannot end the <script> element", () => {
    const json = serializeJsonLd({ name: BREAKOUT, brand: "A & B" });

    expect(json).toBe(
      '{"name":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e","brand":"A \\u0026 B"}',
    );
    expect(json).not.toMatch(/[<>&]/);
  });

  it("escapes U+2028 and U+2029, line breaks to older JavaScript parsers", () => {
    const json = serializeJsonLd({ text: "a\u2028b\u2029c" });

    expect(json).toBe('{"text":"a\\u2028b\\u2029c"}');
  });

  it("still parses back to the same value", () => {
    const data = {
      "@type": "Product",
      name: `${BREAKOUT} & more\u2028`,
      offers: [{ price: 89000 }],
    };

    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});

describe("JsonLd", () => {
  it("renders one application/ld+json block holding the data", () => {
    const { container } = render(
      <JsonLd data={{ "@type": "Product", name: "Kaos Polos" }} />,
    );

    const scripts = container.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("type")).toBe("application/ld+json");
    expect(JSON.parse(scripts[0]?.textContent ?? "")).toEqual({
      "@type": "Product",
      name: "Kaos Polos",
    });
  });

  it("keeps a product name holding </script> inside the block in the server's HTML", () => {
    const html = renderToStaticMarkup(<JsonLd data={{ name: BREAKOUT }} />);

    // One closing tag: the element's own.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html.endsWith("</script>")).toBe(true);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(JSON.parse(doc.querySelector("script")?.textContent ?? "")).toEqual({
      name: BREAKOUT,
    });
  });
});
