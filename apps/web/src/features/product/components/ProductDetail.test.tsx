import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { product, rupiah, variant } from "@/test/fake-api.ts";
import { inRouter } from "@/test/render.tsx";
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
const subtotal = () =>
  screen.queryByText(/Subtotal/)?.querySelector("strong")?.textContent;
const stepperValue = () =>
  screen.getByRole("group", { name: "Jumlah" }).querySelector("output")
    ?.textContent;

beforeEach(() => {
  document.title = "GoShop";
});

describe("ProductDetail", () => {
  it("shows the product's category, name, description and a photo placeholder", () => {
    render(inRouter(<ProductDetail product={kaos()} />));

    const article = screen.getByRole("article", { name: "Kaos Polos" });
    expect(
      screen.getByRole("heading", { level: 1, name: "Kaos Polos" }),
    ).toBeTruthy();
    expect(article.textContent).toContain("Kaos");
    expect(screen.getByText("Katun 100%.")).toBeTruthy();
    expect(screen.getByText("Belum ada foto")).toBeTruthy();
  });

  it("names the tab after the product while it is open", () => {
    const { unmount } = render(inRouter(<ProductDetail product={kaos()} />));
    expect(document.title).toBe("Kaos Polos — GoShop");

    unmount();
    expect(document.title).toBe("GoShop");
  });

  it("starts on the first variant in stock", () => {
    render(inRouter(<ProductDetail product={kaos()} />));

    expect(checkedVariant()).toBe("M");
    expect(price()).toBe(rupiah(89_000));
  });

  it("starts on the first variant when every one is sold out", () => {
    render(
      inRouter(
        <ProductDetail
          product={kaos([
            variant("s", { name: "S", stock: 0 }),
            variant("m", { name: "M", stock: 0 }),
          ])}
        />,
      ),
    );

    expect(checkedVariant()).toBe("S");
  });

  it("shows the price of the variant the buyer picks", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductDetail product={kaos()} />));

    await user.click(screen.getByRole("radio", { name: /^XL/ }));

    expect(checkedVariant()).toBe("XL");
    expect(price()).toBe(rupiah(99_000));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Kaos Polos",
    );
  });

  it("shows Stok habis and no stepper for a sold-out variant", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductDetail product={kaos()} />));
    expect(screen.getByRole("group", { name: "Jumlah" })).toBeTruthy();
    expect(screen.queryByText("Stok habis")).toBeNull();

    await user.click(screen.getByRole("radio", { name: /^S/ }));

    expect(screen.getByText("Stok habis")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Jumlah" })).toBeNull();
    expect(screen.queryByText(/Subtotal/)).toBeNull();
  });

  it("renders without a price or stepper when there is no variant", () => {
    render(inRouter(<ProductDetail product={kaos([])} />));

    expect(price()).toBeUndefined();
    expect(screen.queryByRole("group", { name: "Jumlah" })).toBeNull();
    expect(screen.queryByText("Stok habis")).toBeNull();
  });

  it("shows the subtotal as price times quantity", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductDetail product={kaos()} />));
    expect(subtotal()).toBe(rupiah(89_000));

    await user.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    await user.click(screen.getByRole("button", { name: "Tambah jumlah" }));

    expect(stepperValue()).toBe("3");
    expect(subtotal()).toBe(rupiah(3 * 89_000));
    await user.click(screen.getByRole("button", { name: "Kurangi jumlah" }));
    expect(subtotal()).toBe(rupiah(2 * 89_000));
  });

  it("caps the quantity at the stock of a variant picked later", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductDetail product={kaos()} />));
    for (let i = 0; i < 3; i++) {
      await user.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    }
    expect(stepperValue()).toBe("4");

    await user.click(screen.getByRole("radio", { name: /^XL/ }));

    expect(stepperValue()).toBe("2");
    expect(screen.getByText("Maks. 2")).toBeTruthy();
    expect(subtotal()).toBe(rupiah(2 * 99_000));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Tambah jumlah" })
        .disabled,
    ).toBe(true);
  });

  it("offers at most 99 even when there is more stock", () => {
    render(
      inRouter(
        <ProductDetail
          product={kaos([variant("m", { name: "M", stock: 500 })])}
        />,
      ),
    );

    expect(screen.getByText("Maks. 99")).toBeTruthy();
  });

  it("keeps the capped quantity when the buyer switches back", async () => {
    const user = userEvent.setup();
    render(
      inRouter(
        <ProductDetail
          product={kaos([
            variant("m", { name: "M", stock: 20 }),
            variant("l", { name: "L", stock: 8 }),
          ])}
        />,
      ),
    );
    for (let i = 1; i < 12; i++) {
      await user.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    }
    expect(stepperValue()).toBe("12");

    await user.click(screen.getByRole("radio", { name: /^L/ }));
    expect(stepperValue()).toBe("8");

    await user.click(screen.getByRole("radio", { name: /^M/ }));
    expect(stepperValue()).toBe("8");
    expect(subtotal()).toBe(rupiah(8 * 89_000));
  });

  it("stores 0 for a sold-out variant and 1 when switching back to one in stock", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductDetail product={kaos()} />));
    for (let i = 1; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    }
    expect(stepperValue()).toBe("4");

    await user.click(screen.getByRole("radio", { name: /^S/ }));
    expect(screen.getByText("Stok habis")).toBeTruthy();

    await user.click(screen.getByRole("radio", { name: /^M/ }));
    expect(stepperValue()).toBe("1");
    expect(subtotal()).toBe(rupiah(89_000));
  });

  it("starts at 0, sold out, when every variant is sold out", () => {
    render(
      inRouter(
        <ProductDetail
          product={kaos([
            variant("s", { name: "S", stock: 0 }),
            variant("m", { name: "M", stock: 0 }),
          ])}
        />,
      ),
    );

    expect(screen.getByText("Stok habis")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Jumlah" })).toBeNull();
    expect(screen.queryByText(/Subtotal/)).toBeNull();
  });
});
