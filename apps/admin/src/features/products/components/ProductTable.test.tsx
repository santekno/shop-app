import type { AdminProductTable } from "@goshop/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { formatDateTime } from "@/lib/format-date.ts";
import { productRow, productTable } from "@/test/fixtures.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { DEFAULT_PRODUCT_TABLE_PARAMS } from "../product-table-params.ts";
import type { ProductTableParams } from "../product-table-params.ts";
import { ProductTable } from "./ProductTable.tsx";

// formatDateTime runs for the two date cells of every row each time the
// table's body renders: counting its calls counts those renders
// (artikel 14's memo on ProductTableBody). Its behaviour is kept.
vi.mock("@/lib/format-date.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/format-date.ts")>();
  return { ...actual, formatDateTime: vi.fn(actual.formatDateTime) };
});

const rows = [
  productRow(1, { name: "Kaos Polos", stock: 3, low_stock: true }),
  productRow(2, {
    name: "Topi",
    price_from: null,
    stock: 0,
    variant_count: 2,
    status: "draft",
  }),
];

const renderTable = (
  change: Partial<ProductTableParams> = {},
  result: AdminProductTable = productTable(rows, { total: 45, threshold: 8 }),
  busy = false,
) => {
  const onChange = vi.fn();
  renderRoute(
    <ProductTable
      result={result}
      params={{ ...DEFAULT_PRODUCT_TABLE_PARAMS, ...change }}
      onChange={onChange}
      busy={busy}
    />,
  );
  return onChange;
};

const table = () => screen.getByRole("table");
const header = (name: string) =>
  screen.getByRole("columnheader", { name: new RegExp(`^${name}`) });
const bodyRows = () => within(table()).getAllByRole("row").slice(1);

describe("ProductTable", () => {
  it("names the table and says how it is sorted, in a labelled region", () => {
    renderTable({ sort: "price_from", order: "asc" });

    expect(table()).toHaveAccessibleName(
      "Daftar produk, diurutkan menurut Harga mulai naik",
    );
    expect(
      screen.getByRole("region", { name: /^Daftar produk/ }),
    ).toHaveAttribute("aria-busy", "false");
  });

  it("says a descending sort in the caption too", () => {
    renderTable({ sort: "stock", order: "desc" });

    expect(table()).toHaveAccessibleName(
      "Daftar produk, diurutkan menurut Stok turun",
    );
  });

  it("marks only the sorted column with aria-sort", () => {
    renderTable({ sort: "stock", order: "desc" });

    expect(header("Stok")).toHaveAttribute("aria-sort", "descending");
    for (const name of [
      "Produk",
      "Harga mulai",
      "Diubah",
      "Dibuat",
      "Status",
    ]) {
      expect(header(name)).not.toHaveAttribute("aria-sort");
    }
  });

  it("says ascending for an ascending sort", () => {
    renderTable({ sort: "name", order: "asc" });

    expect(header("Produk")).toHaveAttribute("aria-sort", "ascending");
  });

  it.each([
    ["Produk", { sort: "name", order: "asc" }],
    ["Harga mulai", { sort: "price_from", order: "desc" }],
    ["Stok", { sort: "stock", order: "desc" }],
    ["Dibuat", { sort: "created_at", order: "desc" }],
  ])(
    "sorts by %s on the first click, A–Z for names and largest first for numbers and dates",
    async (name, change) => {
      const user = userEvent.setup();
      const onChange = renderTable();

      await user.click(within(header(name)).getByRole("button"));

      expect(onChange).toHaveBeenCalledExactlyOnceWith(change);
    },
  );

  it("flips the order on a second click of the sorted column", async () => {
    const user = userEvent.setup();
    const onChange = renderTable({ sort: "updated_at", order: "desc" });

    await user.click(within(header("Diubah")).getByRole("button"));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      sort: "updated_at",
      order: "asc",
    });
  });

  it("flips a name sort back to descending", async () => {
    const user = userEvent.setup();
    const onChange = renderTable({ sort: "name", order: "asc" });

    await user.click(within(header("Produk")).getByRole("button"));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      sort: "name",
      order: "desc",
    });
  });

  it("has no sort button for Status, Varian and Foto", () => {
    renderTable();

    for (const name of ["Status", "Varian", "Foto"]) {
      expect(within(header(name)).queryByRole("button")).toBeNull();
    }
  });

  it("shows each row's cells: the name links to the product, with its category", () => {
    renderTable();

    const [first] = bodyRows();
    if (first === undefined) throw new Error("no row");
    expect(
      within(first).getByRole("link", { name: "Kaos Polos" }),
    ).toHaveAttribute("href", `/produk/${productRow(1).id}`);
    expect(first).toHaveTextContent("Kaos");
    expect(first).toHaveTextContent("Aktif");
    expect(plain(first.textContent)).toContain("Rp 89.000");
  });

  it("writes a missing price as a dash, said as 'Belum ada harga'", () => {
    renderTable();

    const [, second] = bodyRows();
    if (second === undefined) throw new Error("no row");
    expect(within(second).getByText("—")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(second).getByText("Belum ada harga")).toHaveClass("sr-only");
  });

  it("shows the stock, warns about low stock with the API's threshold, and says out of stock", () => {
    renderTable();

    const [first, second] = bodyRows();
    if (first === undefined || second === undefined) throw new Error("no row");
    expect(within(first).getByText("Stok menipis")).toHaveAttribute(
      "title",
      "8 unit atau kurang",
    );
    expect(within(second).getByText("Stok habis")).toBeInTheDocument();
    expect(within(second).queryByText("Stok menipis")).toBeNull();
    expect(second).toHaveTextContent("Draf");
  });

  it("puts the dates in <time> with the machine-readable value", () => {
    renderTable();

    const [first] = bodyRows();
    if (first === undefined) throw new Error("no row");
    const times = first.querySelectorAll("time");
    expect(Array.from(times, (time) => time.dateTime)).toEqual([
      productRow(1).updated_at,
      productRow(1).created_at,
    ]);
    expect(times[0]).toHaveTextContent(
      formatDateTime(productRow(1).updated_at),
    );
  });

  it("is busy while the next page loads", () => {
    renderTable({}, productTable(rows, { total: 45 }), true);

    expect(
      screen.getByRole("region", { name: /^Daftar produk/ }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Memuat produk…")).toBeInTheDocument();
  });

  describe("paging", () => {
    it("asks for the next and the last page", async () => {
      const user = userEvent.setup();
      const onChange = renderTable({ page: 1 });

      await user.click(
        screen.getByRole("button", { name: "Halaman berikutnya" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Halaman terakhir" }),
      );

      expect(onChange.mock.calls).toEqual([
        [{ page: 2, perPage: 20 }],
        [{ page: 3, perPage: 20 }],
      ]);
      expect(
        screen.getByRole("button", { name: "Halaman sebelumnya" }),
      ).toBeDisabled();
    });

    it("asks for the previous and the first page", async () => {
      const user = userEvent.setup();
      const onChange = renderTable({ page: 3 });

      await user.click(
        screen.getByRole("button", { name: "Halaman sebelumnya" }),
      );
      await user.click(screen.getByRole("button", { name: "Halaman pertama" }));

      expect(onChange.mock.calls).toEqual([
        [{ page: 2, perPage: 20 }],
        [{ page: 1, perPage: 20 }],
      ]);
      expect(
        screen.getByRole("button", { name: "Halaman berikutnya" }),
      ).toBeDisabled();
    });

    it("counts the pages from the total", () => {
      renderTable({ page: 2 });

      expect(
        screen.getByRole("navigation", { name: "Halaman tabel produk" }),
      ).toHaveTextContent("Halaman 2 dari 3");
    });

    it("asks for another page size", async () => {
      const user = userEvent.setup();
      const onChange = renderTable({ page: 1 });

      await user.selectOptions(
        screen.getByLabelText("Baris per halaman"),
        "50",
      );

      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        page: 1,
        perPage: 50,
      });
    });
  });

  describe("the body's memo (artikel 14)", () => {
    /** The table with its props in state, changed by two test buttons. */
    function Harness() {
      const [busy, setBusy] = useState(false);
      const [result, setResult] = useState(() =>
        productTable(rows, { total: 45 }),
      );
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setBusy((value) => !value);
            }}
          >
            Ganti busy
          </button>
          <button
            type="button"
            onClick={() => {
              setResult(productTable([productRow(3, { name: "Celana" })]));
            }}
          >
            Data baru
          </button>
          <ProductTable
            result={result}
            params={DEFAULT_PRODUCT_TABLE_PARAMS}
            onChange={() => undefined}
            busy={busy}
          />
        </>
      );
    }

    it("does not render the rows again for the same data", async () => {
      const user = userEvent.setup();
      renderRoute(<Harness />);
      const before = vi.mocked(formatDateTime).mock.calls.length;
      expect(before).toBeGreaterThan(0);

      await user.click(screen.getByRole("button", { name: "Ganti busy" }));

      expect(
        screen.getByRole("region", { name: /^Daftar produk/ }),
      ).toHaveAttribute("aria-busy", "true");
      expect(vi.mocked(formatDateTime).mock.calls).toHaveLength(before);
    });

    it("renders the new rows when the data changes", async () => {
      const user = userEvent.setup();
      renderRoute(<Harness />);

      await user.click(screen.getByRole("button", { name: "Data baru" }));

      expect(screen.getByRole("link", { name: "Celana" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Kaos Polos" })).toBeNull();
    });
  });
});
