import { ApiError } from "@goshop/shared";
import type { ProductInput } from "@goshop/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CATEGORY_ID, adminVariant, category } from "@/test/fixtures.ts";
import { categoriesHandler } from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { twoVariantForm, withVariant } from "@/test/products-stock.ts";
import { renderRoute } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { mergeProduct } from "../product-merge.ts";
import type { ConflictCause, MergeChoice } from "../product-merge.ts";
import { ProductConflictReview } from "./ProductConflictReview.tsx";
import type { ConflictReviewState } from "./ProductConflictReview.tsx";

const V1 = adminVariant(1).id;
const V2 = adminVariant(2).id;
const V3 = adminVariant(3).id;
const OTHER_CATEGORY = "66666666-6666-4666-8666-666666666666";

const ready = (
  edit: (values: ProductInput) => ProductInput,
  server_: (values: ProductInput) => ProductInput,
  rejectedVariantId?: string,
): ConflictReviewState => {
  const base = twoVariantForm();
  return {
    status: "ready",
    merge: mergeProduct({
      base,
      mine: edit(base),
      latest: server_(base),
      rejectedVariantId,
    }),
  };
};
const same = (values: ProductInput) => values;

const renderReview = (
  state: ConflictReviewState,
  cause: ConflictCause = { kind: "product" },
) => {
  server.use(
    categoriesHandler([
      category(CATEGORY_ID, "Kaos"),
      category(OTHER_CATEGORY, "Kemeja"),
    ]),
  );
  const onRetry = vi.fn();
  const onKeepMine = vi.fn<(choices: Record<string, MergeChoice>) => void>();
  const onDiscard = vi.fn();
  renderRoute(
    <ProductConflictReview
      state={state}
      cause={cause}
      onRetry={onRetry}
      onKeepMine={onKeepMine}
      onDiscard={onDiscard}
    />,
  );
  return { onRetry, onKeepMine, onDiscard, user: userEvent.setup() };
};

const heading = () =>
  screen.getByRole("heading", {
    level: 2,
    name: "Produk ini berubah sejak Anda membukanya",
  });
/** A part of the review: its section (the table inside is named the same). */
const group = (title: string) => {
  const [section] = screen.getAllByRole("region", { name: title });
  if (section === undefined) throw new Error(`no group ${title}`);
  return section;
};
const rows = (title: string) =>
  within(within(group(title)).getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => plain(row.textContent));

describe("ProductConflictReview", () => {
  it("says it is fetching the latest product, focused on its heading", () => {
    renderReview({ status: "loading" });

    expect(heading()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Memuat data terbaru dari server…",
    );
  });

  it("offers to fetch again after a failure", async () => {
    const { user, onRetry } = renderReview({
      status: "error",
      error: new ApiError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "x",
      }),
    });

    await user.click(
      within(screen.getByRole("alert")).getByRole("button", {
        name: "Coba lagi",
      }),
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["product", "admin lain menyimpan atau mengarsipkan produk ini"],
    ["variant", "stok varian di bawah berubah di server"],
    ["archived", "varian yang masih ada di formulir Anda diarsipkan di server"],
  ] as const)("explains a '%s' conflict in its own words", (kind, text) => {
    renderReview(ready(same, same), { kind });

    expect(heading()).toHaveFocus();
    expect(
      screen.getByText(/Belum ada yang tersimpan\./).parentElement,
    ).toHaveTextContent(text);
  });

  it("says only the version changed when no value did", () => {
    renderReview(ready(same, same));

    expect(
      screen.getByText(/Nilai di server sama dengan saat Anda membukanya/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Info dasar" })).toBeNull();
  });

  it("shows a server-only change as taken, and counts it", async () => {
    renderReview(
      ready(same, (v) => ({
        ...v,
        category_id: OTHER_CATEGORY,
        status: "draft",
      })),
    );

    expect(
      screen.getByText(
        "2 perubahan di server, tidak ada yang bentrok dengan perubahan Anda.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(rows("Info dasar")).toEqual([
        "KategoriKaostidak diubahKemejadipakai",
        "StatusAktiftidak diubahDrafdipakai",
      ]);
    });
  });

  it("shows the seller's own change as kept, formatted", () => {
    renderReview(
      ready(
        (v) => withVariant(v, 0, { price: "99000", weight_grams: "1250" }),
        same,
      ),
    );

    expect(rows("Varian M (KAOS-M)")).toEqual([
      "HargaRp 89.000Rp 99.000dipakaitidak diubah",
      "Berat250 g1.250 gdipakaitidak diubah",
    ]);
  });

  it("cuts a long description in the table", () => {
    const long = "a".repeat(200);
    renderReview(ready((v) => ({ ...v, description: long }), same));

    expect(rows("Info dasar")[0]).toContain(`${"a".repeat(120)}…`);
    expect(rows("Info dasar")[0]).not.toContain("a".repeat(121));
  });

  it("shows an empty value as a dash, and an unknown category or status as written", async () => {
    renderReview(
      ready(
        (v) => ({ ...v, description: "" }),
        (v) => ({ ...v, category_id: "x-y" }),
      ),
    );

    await waitFor(() => {
      expect(rows("Info dasar")).toEqual([
        "Kategori" + "Kaos" + "tidak diubah" + "x-y" + "dipakai",
        "DeskripsiKaos katun.—dipakaitidak diubah",
      ]);
    });
  });

  describe("conflicts", () => {
    const conflicted = () =>
      ready(
        (v) => withVariant({ ...v, name: "Kaos A" }, 0, { stock: "17" }),
        (v) => withVariant({ ...v, name: "Kaos B" }, 0, { stock: "10" }),
        V1,
      );

    it("counts them, marks them, and asks for each with nothing chosen", () => {
      renderReview(conflicted(), { kind: "variant", variantId: V1 });

      expect(
        screen.getByText(
          "2 perubahan di server, 2 di antaranya pada isian yang juga Anda ubah: pilih nilai yang disimpan.",
        ),
      ).toBeInTheDocument();
      const name = screen.getByRole("group", {
        name: "Nama: nilai mana yang disimpan?",
      });
      expect(
        within(name)
          .getAllByRole("radio")
          .map((radio) => radio.parentElement?.textContent),
      ).toEqual(["Milik Anda: Kaos A", "Dari server: Kaos B"]);
      expect(
        within(name)
          .getAllByRole("radio")
          .every((radio) => !(radio as HTMLInputElement).checked),
      ).toBe(true);
      expect(rows("Info dasar")[0]).toContain("bentrok: pilih di bawah");
    });

    it("offers the server's stock plus the seller's change for stock, and names the variant", () => {
      renderReview(conflicted(), { kind: "variant", variantId: V1 });

      const stock = screen.getByRole("group", {
        name: "Stok M (KAOS-M): nilai mana yang disimpan?",
      });
      expect(
        within(stock)
          .getAllByRole("radio")
          .map((radio) => radio.parentElement?.textContent),
      ).toEqual([
        "Milik Anda: 17",
        "Dari server: 10",
        "Server ditambah perubahan Anda: 10 + 5 = 15",
      ]);
      expect(stock).toHaveTextContent(
        "Stok di server sudah memperhitungkan pembelian",
      );
      expect(group("Varian M (KAOS-M)")).toHaveTextContent(
        "Server menolak penyimpanan karena stok varian ini berubah.",
      );
    });

    it("writes a decrease in the combined option with a minus sign", () => {
      renderReview(
        ready(
          (v) => withVariant(v, 0, { stock: "9" }),
          (v) => withVariant(v, 0, { stock: "10" }),
        ),
      );

      expect(
        screen.getByRole("radio", {
          name: "Server ditambah perubahan Anda: 10 − 3 = 7",
        }),
      ).toBeInTheDocument();
    });

    it("refuses to go on until every conflict is chosen, focusing the first open one", async () => {
      const { user, onKeepMine } = renderReview(conflicted());

      await user.click(
        screen.getByRole("button", {
          name: "Terapkan perubahan saya ke data terbaru",
        }),
      );

      expect(onKeepMine).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Pilih nilai yang disimpan untuk 2 isian yang bentrok.",
      );
      expect(
        screen.getByRole("radio", { name: "Milik Anda: Kaos A" }),
      ).toHaveFocus();
      expect(
        screen.getByRole("radio", { name: "Milik Anda: Kaos A" }),
      ).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByRole("group", { name: "Nama: nilai mana yang disimpan?" }),
      ).toHaveAccessibleDescription("Pilih salah satu.");
    });

    it("forgets a conflict's message once it is chosen, and passes the choices on", async () => {
      const { user, onKeepMine } = renderReview(conflicted());
      await user.click(
        screen.getByRole("button", {
          name: "Terapkan perubahan saya ke data terbaru",
        }),
      );

      await user.click(
        screen.getByRole("radio", { name: "Dari server: Kaos B" }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent("untuk 1 isian");
      expect(
        screen.getByRole("radio", { name: "Milik Anda: Kaos A" }),
      ).not.toHaveAttribute("aria-invalid");
      await user.click(
        screen.getByRole("radio", {
          name: "Server ditambah perubahan Anda: 10 + 5 = 15",
        }),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      await user.click(
        screen.getByRole("button", {
          name: "Terapkan perubahan saya ke data terbaru",
        }),
      );

      expect(onKeepMine).toHaveBeenCalledExactlyOnceWith({
        name: "theirs",
        [`variants.${V1}.stock`]: "combined",
      });
    });
  });

  it("goes on at once without conflicts, and discards on request", async () => {
    const { user, onKeepMine, onDiscard } = renderReview(
      ready(same, (v) => ({ ...v, name: "Baru" })),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Terapkan perubahan saya ke data terbaru",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Buang perubahan saya" }),
    );

    expect(onKeepMine).toHaveBeenCalledExactlyOnceWith({});
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  describe("whole variants", () => {
    it("says a removed variant stays archived, with the server's changes meanwhile", () => {
      renderReview(
        ready(
          (v) => ({ ...v, variants: v.variants.slice(0, 1) }),
          (v) => withVariant(v, 1, { stock: "1" }),
        ),
      );

      const removed = group("Varian L (KAOS-L)");
      expect(removed).toHaveTextContent(
        "Anda menghapus varian ini dari daftar; varian ini tetap diarsipkan saat disimpan. Sementara itu, di server:",
      );
      expect(rows("Varian L (KAOS-L)")).toEqual(["Stok4dihapus1"]);
    });

    it("says a removed variant stays archived, without a table when the server changed nothing", () => {
      renderReview(
        ready((v) => ({ ...v, variants: v.variants.slice(0, 1) }), same),
      );

      const removed = group("Varian L (KAOS-L)");
      expect(removed).toHaveTextContent(
        /^Varian L \(KAOS-L\)Anda menghapus varian ini dari daftar; varian ini tetap diarsipkan saat disimpan\.$/,
      );
      expect(within(removed).queryByRole("table")).toBeNull();
    });

    it("says a variant archived by someone else is dropped", () => {
      renderReview(
        ready(same, (v) => ({ ...v, variants: v.variants.slice(0, 1) })),
      );

      expect(group("Varian L (KAOS-L)")).toHaveTextContent(
        "Varian ini sudah diarsipkan di server (oleh admin lain), jadi tidak dapat disimpan lagi",
      );
    });

    it("says a variant someone else added is kept, with its price and stock", () => {
      const added = {
        id: V3,
        version: 1,
        sku: "KAOS-XL",
        name: "XL",
        price: "95000",
        stock: "1250",
        weight_grams: "300",
      };
      renderReview(
        ready(same, (v) => ({ ...v, variants: [...v.variants, added] })),
      );

      expect(group("Varian XL (KAOS-XL)")).toHaveTextContent(
        "Varian ini ditambahkan admin lain setelah Anda membuka produk (Rp 95.000, stok 1.250). Varian ini tetap ada dan ikut disimpan apa adanya.",
      );
    });

    it("says the seller's new variants are still added", () => {
      renderReview(
        ready(
          (v) => ({
            ...v,
            variants: [
              ...v.variants,
              {
                sku: "kaos-s",
                name: "S",
                price: "1",
                stock: "1",
                weight_grams: "1",
              },
            ],
          }),
          same,
        ),
      );

      expect(
        screen.getByText("Varian baru Anda (S (KAOS-S)) tetap ditambahkan."),
      ).toBeInTheDocument();
    });

    it("does not list a kept variant nothing happened to", () => {
      renderReview(ready(same, (v) => withVariant(v, 1, { stock: "1" })));

      expect(
        screen.queryByRole("region", { name: "Varian M (KAOS-M)" }),
      ).toBeNull();
      expect(group("Varian L (KAOS-L)")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: `Varian ${V2}` })).toBeNull();
    });
  });
});
