import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { product, rupiah, variant } from "@/test/fake-api.ts";
import { ProductDetail } from "./ProductDetail.tsx";

const kaos = (variants = defaultVariants) =>
  product("kaos-polos", {
    name: "Kaos Polos",
    description: "Katun 100%.",
    variants,
  });

const defaultVariants = [
  variant("s", { name: "S", stock: 0 }),
  variant("m", { name: "M", stock: 5 }),
  variant("xl", {
    name: "XL",
    stock: 2,
    price: { amount: 99_000, currency: "IDR" },
  }),
];

const checkedVariant = () =>
  screen
    .getAllByRole<HTMLInputElement>("radio")
    .find((radio) => radio.checked)
    ?.closest("label")
    ?.querySelector(".variant-picker__name")?.textContent;

const price = () => document.querySelector(".price--large")?.textContent;

beforeEach(() => {
  document.title = "GoShop";
});

describe("ProductDetail", () => {
  it("shows the product's category, name, description and a photo placeholder", () => {
    render(<ProductDetail product={kaos()} />);

    const article = screen.getByRole("article", { name: "Kaos Polos" });
    expect(
      screen.getByRole("heading", { level: 2, name: "Kaos Polos" }),
    ).toBeTruthy();
    expect(article.textContent).toContain("Kaos");
    expect(screen.getByText("Katun 100%.")).toBeTruthy();
    expect(screen.getByText("Belum ada foto")).toBeTruthy();
  });

  it("names the tab after the product while it is open", () => {
    const { unmount } = render(<ProductDetail product={kaos()} />);
    expect(document.title).toBe("Kaos Polos — GoShop");

    unmount();
    expect(document.title).toBe("GoShop");
  });

  it("starts on the first variant in stock", () => {
    render(<ProductDetail product={kaos()} />);

    expect(checkedVariant()).toBe("M");
    expect(price()).toBe(rupiah(89_000));
  });

  it("starts on the first variant when every one is sold out", () => {
    render(
      <ProductDetail
        product={kaos([
          variant("s", { name: "S", stock: 0 }),
          variant("m", { name: "M", stock: 0 }),
        ])}
      />,
    );

    expect(checkedVariant()).toBe("S");
  });

  it("shows the price of the variant the buyer picks", async () => {
    const user = userEvent.setup();
    render(<ProductDetail product={kaos()} />);

    await user.click(screen.getByRole("radio", { name: /^XL/ }));

    expect(checkedVariant()).toBe("XL");
    expect(price()).toBe(rupiah(99_000));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Kaos Polos",
    );
  });

  it("shows Stok habis and no stepper for a sold-out variant", async () => {
    const user = userEvent.setup();
    render(<ProductDetail product={kaos()} />);
    expect(screen.getByRole("group", { name: "Jumlah" })).toBeTruthy();
    expect(screen.queryByText("Stok habis")).toBeNull();

    await user.click(screen.getByRole("radio", { name: /^S/ }));

    expect(screen.getByText("Stok habis")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Jumlah" })).toBeNull();
    expect(screen.queryByText(/Subtotal/)).toBeNull();
  });

  it("renders without a price or stepper when there is no variant", () => {
    render(<ProductDetail product={kaos([])} />);

    expect(price()).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Jumlah" })).toBeNull();
    expect(screen.queryByText("Stok habis")).toBeNull();
  });
});
