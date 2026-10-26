import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  errorResponse,
  fetchMock,
  product,
  productResponse,
} from "@/test/fake-api.ts";
import { ProductDetailPage } from "./ProductDetailPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const back = () => screen.getByRole("button", { name: "← Kembali ke katalog" });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("ProductDetailPage", () => {
  it("puts the focus on the back button, which calls onBack", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<ProductDetailPage slug="kaos" onBack={onBack} />);

    expect(document.activeElement).toBe(back());
    await user.click(back());

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("says Memuat produk… while loading, then shows the product", async () => {
    const answer = deferred<Response>();
    fetchMock.mockReturnValue(answer.promise);
    render(<ProductDetailPage slug="kaos-polos" onBack={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toBe("Memuat produk…");
    answer.resolve(
      productResponse(product("kaos-polos", { name: "Kaos Polos" })),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Kaos Polos" }),
    ).toBeTruthy();
    expect(screen.queryByText("Memuat produk…")).toBeNull();
  });

  it("says Produk tidak ditemukan. for an unknown slug, with no retry", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "NOT_FOUND", "req-404"));
    render(<ProductDetailPage slug="nope" onBack={vi.fn()} />);

    expect(await screen.findByText("Produk tidak ditemukan.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    expect(back()).toBeTruthy();
  });

  it("shows any other error with Coba lagi, which loads it again", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL_ERROR", "req-1"))
      .mockResolvedValueOnce(
        productResponse(product("kaos", { name: "Kaos" })),
      );
    render(<ProductDetailPage slug="kaos" onBack={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Kode permintaan: req-1");
    expect(screen.queryByText("Produk tidak ditemukan.")).toBeNull();
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "Kaos" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
