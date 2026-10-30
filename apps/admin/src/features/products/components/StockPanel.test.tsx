import type { AdminProduct } from "@goshop/shared";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PRODUCT_ID, adminProduct, adminVariant } from "@/test/fixtures.ts";
import { deferred } from "@/test/msw/answers.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  productDetailHandler,
  productResponse,
  stockAdjustmentHandler,
  variantResponse,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { useAdminProduct } from "../hooks/useAdminProduct.ts";
import { StockPanel } from "./StockPanel.tsx";

const M = adminVariant(1, { name: "M", sku: "KAOS-M", stock: 12 });
const L = adminVariant(2, { name: "L", sku: "KAOS-L", stock: 3 });
const XL = adminVariant(3, { name: "XL", sku: "KAOS-XL", stock: 0 });

/** The panel the way the edit page has it: fed by the product query. */
function Page() {
  const { data } = useAdminProduct(PRODUCT_ID);
  return data === undefined ? null : <StockPanel product={data} />;
}

/**
 * Renders the panel with `products` as what GET answers, in turn (the
 * last one repeats): the first load, then each refetch.
 */
const renderPanel = (...products: AdminProduct[]) => {
  let gets = 0;
  server.use(
    productDetailHandler(() => {
      const value =
        products[Math.min(gets, products.length - 1)] ?? adminProduct();
      gets += 1;
      return productResponse(value);
    }),
  );
  renderRoute(<Page />);
  return { gets: () => gets };
};

const panel = () => screen.getByRole("region", { name: "Stok" });
const editButton = (name: string) =>
  within(panel()).getByRole("button", { name: `Ubah stok ${name}` });
const editor = (name: string) =>
  screen.getByRole("group", { name: `Ubah stok ${name}` });

const openEditor = async (name = "M") => {
  const user = userEvent.setup();
  await screen.findByRole("region", { name: "Stok" });
  await user.click(editButton(name));
  return { user, group: editor(name) };
};

describe("StockPanel", () => {
  it("lists every variant's stock with its badge, and sums it up", async () => {
    renderPanel(adminProduct({ variants: [M, L, XL] }));
    await screen.findByRole("region", { name: "Stok" });

    expect(plain(panel().textContent)).toContain(
      "Total 15 unit di 3 varian, 1 habis, 1 menipis (5 atau kurang).",
    );
    const [m, l, xl] = within(panel()).getAllByRole("listitem");
    if (m === undefined || l === undefined || xl === undefined) {
      throw new Error("three rows expected");
    }
    expect(plain(m.textContent)).toContain("MKAOS-M12 unit");
    expect(within(l).getByText("Stok menipis")).toBeInTheDocument();
    expect(within(xl).getByText("Stok habis")).toBeInTheDocument();
    expect(within(m).queryByText(/Stok (habis|menipis)/)).toBeNull();
  });

  it("leaves out the counts that are zero", async () => {
    renderPanel(adminProduct({ variants: [M] }));
    await screen.findByRole("region", { name: "Stok" });

    expect(plain(panel().textContent)).toContain(
      "Total 12 unit di 1 varian. Ubah stok",
    );
  });

  it("opens one editor at a time, under its row, with the focus in the field", async () => {
    renderPanel(adminProduct({ variants: [M, L] }));
    const { user, group } = await openEditor("M");

    expect(editButton("M")).toHaveAttribute("aria-expanded", "true");
    expect(editButton("M")).toHaveAttribute("aria-controls", group.id);
    expect(within(group).getByLabelText("Jumlah perubahan")).toHaveFocus();
    expect(
      within(group).getByRole("radio", { name: "Tambah atau kurangi" }),
    ).toBeChecked();

    await user.click(editButton("L"));
    expect(screen.queryByRole("group", { name: "Ubah stok M" })).toBeNull();
    expect(editButton("M")).toHaveAttribute("aria-expanded", "false");
    expect(editButton("M")).not.toHaveAttribute("aria-controls");
    expect(editor("L")).toBeInTheDocument();

    await user.click(editButton("L"));
    expect(screen.queryByRole("group", { name: "Ubah stok L" })).toBeNull();
  });

  it("previews the stock a difference or a count gives", async () => {
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();

    expect(group).toHaveTextContent("Stok sekarang 12.");
    await user.type(within(group).getByLabelText("Jumlah perubahan"), "-2");
    expect(group).toHaveTextContent("Stok sekarang 12, menjadi 10.");

    await user.click(
      within(group).getByRole("radio", { name: "Setel jumlah" }),
    );
    const count = within(group).getByLabelText("Stok baru");
    await user.clear(count);
    await user.type(count, "1.250");
    expect(group).toHaveTextContent("Stok sekarang 12, menjadi 1.250.");
  });

  it("checks the input before sending, focusing it, and clears the message as the seller types", async () => {
    const sent = recordRequests();
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();
    const field = within(group).getByLabelText("Jumlah perubahan");

    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );

    expect(field).toHaveAccessibleDescription(/Isi jumlahnya, misalnya 20/);
    expect(field).toHaveFocus();
    await user.type(field, "1");
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(sent.filter((r) => r.method === "POST")).toEqual([]);
  });

  it("saves a difference, says so, closes and gives the focus back to its button", async () => {
    const sent = recordRequests();
    server.use(
      stockAdjustmentHandler(() =>
        variantResponse({ ...M, stock: 32, version: 2 }),
      ),
    );
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();

    await user.type(within(group).getByLabelText("Jumlah perubahan"), "+20");
    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );

    expect(await within(panel()).findByRole("status")).toHaveTextContent(
      "Stok M: 12 → 32. Tersimpan.",
    );
    expect(screen.queryByRole("group", { name: "Ubah stok M" })).toBeNull();
    expect(editButton("M")).toHaveFocus();
    expect(plain(panel().textContent)).toContain("32 unit");
    expect(await sent.find((r) => r.method === "POST")?.json()).toEqual({
      delta: 20,
    });
  });

  it("sends a count with the stock shown when the editor opened, even after a refetch moved it", async () => {
    const sent = recordRequests();
    server.use(
      stockAdjustmentHandler(() => variantResponse({ ...M, stock: 20 })),
    );
    let gets = 0;
    server.use(
      productDetailHandler(() => {
        gets += 1;
        return productResponse(
          adminProduct({ variants: [{ ...M, stock: gets === 1 ? 12 : 10 }] }),
        );
      }),
    );
    const { queryClient } = renderRoute(<Page />);
    const { user, group } = await openEditor();

    // A sale while the seller counts: the row shows 10, the count still
    // checks against the 12 the seller started from.
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => {
      expect(group).toHaveTextContent("Stok sekarang 10.");
    });
    await user.click(
      within(group).getByRole("radio", { name: "Setel jumlah" }),
    );
    await user.type(within(group).getByLabelText("Stok baru"), "20");
    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );

    await within(panel()).findByText("Stok M: 12 → 20. Tersimpan.");
    expect(await sent.find((r) => r.method === "POST")?.json()).toEqual({
      set: 20,
      expected: 12,
    });
  });

  it("says 'Menyimpan…' and disables its buttons while saving; Escape does not close it then", async () => {
    const answer = deferred<Response>();
    server.use(stockAdjustmentHandler(() => answer.promise));
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();

    await user.type(within(group).getByLabelText("Jumlah perubahan"), "1");
    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );

    expect(
      await within(group).findByRole("button", { name: "Menyimpan…" }),
    ).toBeDisabled();
    expect(within(group).getByRole("button", { name: "Batal" })).toBeDisabled();
    fireEvent.keyDown(within(group).getByLabelText("Jumlah perubahan"), {
      key: "Escape",
    });
    expect(editor("M")).toBeInTheDocument();

    answer.resolve(variantResponse({ ...M, stock: 13 }));
    await within(panel()).findByText("Stok M: 12 → 13. Tersimpan.");
  });

  it("closes on Batal and on Escape, giving the focus back", async () => {
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();

    await user.click(within(group).getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("group", { name: "Ubah stok M" })).toBeNull();
    expect(editButton("M")).toHaveFocus();

    await user.click(editButton("M"));
    fireEvent.keyDown(within(editor("M")).getByLabelText("Jumlah perubahan"), {
      key: "Escape",
    });
    expect(screen.queryByRole("group", { name: "Ubah stok M" })).toBeNull();
    expect(editButton("M")).toHaveFocus();
  });

  it("ignores other keys", async () => {
    renderPanel(adminProduct({ variants: [M] }));
    const { group } = await openEditor();

    fireEvent.keyDown(within(group).getByLabelText("Jumlah perubahan"), {
      key: "Enter",
    });

    expect(editor("M")).toBeInTheDocument();
  });

  describe("when the stock moved under a count (STOCK_CHANGED)", () => {
    const moveTo = async (current: number, wanted: string) => {
      const sent = recordRequests();
      let posts = 0;
      server.use(
        stockAdjustmentHandler(() => {
          posts += 1;
          return posts === 1
            ? errorResponse(409, "STOCK_CHANGED", {
                details: { stock: current },
              })
            : variantResponse({ ...M, stock: Number(wanted) });
        }),
      );
      renderPanel(
        adminProduct({ variants: [M] }),
        adminProduct({ variants: [{ ...M, stock: current }] }),
      );
      const { user, group } = await openEditor();
      await user.click(
        within(group).getByRole("radio", { name: "Setel jumlah" }),
      );
      await user.type(within(group).getByLabelText("Stok baru"), wanted);
      await user.click(
        within(group).getByRole("button", { name: "Simpan stok" }),
      );
      const alert = await within(group).findByRole("alert");
      return { sent, user, group, alert };
    };

    it("says by how much, focused, and offers the count anyway or the difference on top", async () => {
      const { alert } = await moveTo(10, "20");

      expect(alert).toHaveTextContent(
        "Stok M berubah dari 12 menjadi 10 sejak Anda mulai (pembelian, pembatalan pesanan, atau admin lain). Belum ada yang tersimpan. Anda ingin menyetel 20.",
      );
      await waitFor(() => {
        expect(alert).toHaveFocus();
      });
      expect(
        within(alert).getByRole("button", { name: "Tetap setel 20" }),
      ).toBeInTheDocument();
      expect(
        within(alert).getByRole("button", { name: "Pakai 10 +8 = 18" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Simpan stok" })).toBeNull();
    });

    it("sets the count against the stock now", async () => {
      const { sent, user, alert } = await moveTo(10, "20");

      await user.click(
        within(alert).getByRole("button", { name: "Tetap setel 20" }),
      );

      await within(panel()).findByText("Stok M: 10 → 20. Tersimpan.");
      const posts = sent.filter((r) => r.method === "POST");
      expect(await posts[1]?.json()).toEqual({ set: 20, expected: 10 });
    });

    it("sends the difference as a delta from 'Pakai'", async () => {
      const { sent, user, alert } = await moveTo(10, "20");

      await user.click(
        within(alert).getByRole("button", { name: "Pakai 10 +8 = 18" }),
      );

      await within(panel()).findByRole("status");
      const posts = sent.filter((r) => r.method === "POST");
      expect(await posts[1]?.json()).toEqual({ delta: 8 });
    });

    it("writes a decrease with a minus sign", async () => {
      const { alert } = await moveTo(10, "7");

      expect(
        within(alert).getByRole("button", { name: "Pakai 10 −5 = 5" }),
      ).toBeInTheDocument();
    });

    it("hides 'Pakai' when the result would go below 0", async () => {
      const { alert } = await moveTo(2, "5");

      // 2 + (5 − 12) = −5: no such stock.
      expect(
        within(alert).queryByRole("button", { name: /^Pakai/ }),
      ).toBeNull();
      expect(
        within(alert).getByRole("button", { name: "Tetap setel 5" }),
      ).toBeInTheDocument();
    });

    it("hides 'Pakai' when the result would pass the maximum", async () => {
      const { alert } = await moveTo(999_999, "20");

      // 999.999 + (20 − 12) = 1.000.007: above 1.000.000.
      expect(
        within(alert).queryByRole("button", { name: /^Pakai/ }),
      ).toBeNull();
      expect(
        within(alert).getByRole("button", { name: "Tetap setel 20" }),
      ).toBeInTheDocument();
    });

    it("hides 'Pakai' when the seller's count equals what they saw", async () => {
      const { alert } = await moveTo(10, "12");

      expect(
        within(alert).queryByRole("button", { name: /^Pakai/ }),
      ).toBeNull();
    });

    it("closes from Batal, and switching the mode clears it", async () => {
      const { user, group, alert } = await moveTo(10, "20");

      await user.click(
        within(group).getByRole("radio", { name: "Tambah atau kurangi" }),
      );
      expect(alert).not.toBeInTheDocument();
      expect(
        within(group).getByRole("button", { name: "Simpan stok" }),
      ).toBeInTheDocument();
    });

    it("closes the editor from the alert's Batal", async () => {
      const { user, alert } = await moveTo(10, "20");

      await user.click(within(alert).getByRole("button", { name: "Batal" }));

      expect(screen.queryByRole("group", { name: "Ubah stok M" })).toBeNull();
      expect(editButton("M")).toHaveFocus();
    });
  });

  it.each([
    [
      -15,
      "Stok sekarang 3; tidak bisa dikurangi sebanyak itu. Belum ada yang tersimpan.",
    ],
    [
      999_999,
      "Stok sekarang 3; hasilnya melebihi batas 1.000.000. Belum ada yang tersimpan.",
    ],
  ])(
    "explains a difference of %d that would leave the range, keeping the editor",
    async (amount, message) => {
      server.use(
        stockAdjustmentHandler(() =>
          errorResponse(409, "STOCK_OUT_OF_RANGE", { details: { stock: 3 } }),
        ),
      );
      renderPanel(adminProduct({ variants: [M] }));
      const { user, group } = await openEditor();
      const field = within(group).getByLabelText("Jumlah perubahan");

      await user.type(field, String(amount));
      await user.click(
        within(group).getByRole("button", { name: "Simpan stok" }),
      );

      await waitFor(() => {
        expect(field).toHaveAccessibleDescription(
          new RegExp(message.replace(/[.()]/g, "\\$&")),
        );
      });
      expect(field).toHaveFocus();
    },
  );

  it("says a variant archived on the server was not changed, focusing the heading", async () => {
    server.use(
      stockAdjustmentHandler(() => errorResponse(409, "VARIANT_ARCHIVED")),
    );
    renderPanel(
      adminProduct({ variants: [M, L] }),
      adminProduct({ variants: [L] }),
    );
    const { user, group } = await openEditor("M");

    await user.type(within(group).getByLabelText("Jumlah perubahan"), "1");
    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );

    expect(await within(panel()).findByRole("status")).toHaveTextContent(
      "Varian M sudah diarsipkan di server; stoknya tidak diubah.",
    );
    expect(screen.getByRole("heading", { name: "Stok" })).toHaveFocus();
    await waitFor(() => {
      expect(
        within(panel()).queryByRole("button", { name: "Ubah stok M" }),
      ).toBeNull();
    });
  });

  it("shows a server error under the field, keeping the editor open", async () => {
    server.use(
      stockAdjustmentHandler(() => errorResponse(500, "INTERNAL_ERROR")),
    );
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();
    const field = within(group).getByLabelText("Jumlah perubahan");

    await user.type(field, "1");
    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );

    await waitFor(() => {
      expect(field).toHaveAccessibleDescription(
        /Stok belum tersimpan karena kesalahan di server\. Coba lagi\./,
      );
    });
    expect(field).toHaveFocus();
  });

  it("clears the last announcement when an editor opens again", async () => {
    server.use(
      stockAdjustmentHandler(() => variantResponse({ ...M, stock: 13 })),
    );
    renderPanel(adminProduct({ variants: [M] }));
    const { user, group } = await openEditor();
    await user.type(within(group).getByLabelText("Jumlah perubahan"), "1");
    await user.click(
      within(group).getByRole("button", { name: "Simpan stok" }),
    );
    await within(panel()).findByText("Stok M: 12 → 13. Tersimpan.");

    await user.click(editButton("M"));

    expect(within(panel()).getByRole("status")).toHaveTextContent("");
  });
});
