import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CATEGORY_ID, adminProduct } from "@/test/fixtures.ts";
import { deferred } from "@/test/deferred.ts";
import type { Answer } from "@/test/msw/answers.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  categoriesHandler,
  categoriesResponse,
  createProductHandler,
  productResponse,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import {
  fillInfo,
  fillVariant,
  formCategories,
  stepHeading,
} from "@/test/products-form.ts";
import { Landed } from "@/test/products-form-landed.tsx";
import { renderRoutes } from "@/test/render.tsx";
import { plain } from "@/test/text.ts";
import { ProductCreatePage } from "./ProductCreatePage.tsx";

const created = adminProduct({
  id: "77777777-7777-4777-8777-000000000001",
  name: "Kaos Polos Hitam",
  status: "draft",
});

const renderCreate = (
  categories: Answer = () => categoriesResponse(formCategories),
) => {
  server.use(categoriesHandler(categories));
  return renderRoutes(
    [
      { path: "/produk/baru", element: <ProductCreatePage /> },
      { path: "/produk/:productId", element: <Landed /> },
      { path: "/produk", element: <Landed /> },
    ],
    { url: "/produk/baru" },
  );
};

/** Info dasar filled, on "Varian & harga". */
const toVariants = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByRole("option", { name: "Kaos" });
  await fillInfo(user);
  await user.click(screen.getByRole("button", { name: "Lanjut" }));
  await waitFor(() => {
    expect(stepHeading("Varian & harga")).toHaveFocus();
  });
};

/** Both steps filled, on "Tinjau". */
const toReview = async (user: ReturnType<typeof userEvent.setup>) => {
  await toVariants(user);
  await fillVariant(user, 0);
  await user.click(screen.getByRole("button", { name: "Lanjut" }));
  await waitFor(() => {
    expect(stepHeading("Tinjau")).toHaveFocus();
  });
};

describe("ProductCreatePage", () => {
  describe("Info dasar", () => {
    it("starts on step 1 of 3, a draft, with the page's title", async () => {
      renderCreate();

      expect(
        screen.getByRole("heading", { level: 1, name: "Tambah produk" }),
      ).toBeInTheDocument();
      expect(stepHeading("Info dasar")).toBeInTheDocument();
      expect(screen.getByText("Langkah 1 dari 3")).toBeInTheDocument();
      expect(screen.getByLabelText("Status")).toHaveValue("draft");
      expect(screen.getByRole("link", { name: "Batal" })).toHaveAttribute(
        "href",
        "/produk",
      );
      expect(document.title).toBe("Tambah produk — GoShop Admin");
      await screen.findByRole("option", { name: "Kaos" });
    });

    it("makes the slug from the name until the seller edits the slug", async () => {
      const user = userEvent.setup();
      renderCreate();
      const name = screen.getByLabelText("Nama produk");
      const slug = screen.getByLabelText("Slug");

      await user.type(name, "Kopi Gayo 250 gr (Biji)");
      expect(slug).toHaveValue("kopi-gayo-250-gr-biji");
      expect(slug).toHaveAccessibleDescription(/Dibuat dari nama/);

      await user.clear(slug);
      await user.type(slug, "kopi-gayo");
      await user.type(name, " Premium");

      expect(slug).toHaveValue("kopi-gayo");
    });

    it("lists the categories as a tree, saying so while they load", async () => {
      const answer = deferred<Response>();
      renderCreate(() => answer.promise);

      expect(
        screen.getByRole("option", { name: "Memuat kategori…" }),
      ).toBeDisabled();
      answer.resolve(categoriesResponse(formCategories));

      await waitFor(() => {
        expect(
          screen.queryByRole("option", { name: "Memuat kategori…" }),
        ).toBeNull();
      });
      expect(
        within(screen.getByLabelText("Kategori"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["Pilih kategori…", "Kaos", "Pakaian", "   Kemeja"]);
    });

    it("says the categories failed, and loads them again from Coba lagi", async () => {
      let calls = 0;
      const user = userEvent.setup();
      renderCreate(() => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, "INTERNAL_ERROR")
          : categoriesResponse(formCategories);
      });

      expect(
        await screen.findByText(/Kategori tidak dapat dimuat\./),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Kategori")).toHaveAccessibleDescription(
        /Kategori tidak dapat dimuat\. Coba lagi/,
      );
      await user.click(screen.getByRole("button", { name: "Coba lagi" }));

      expect(
        await screen.findByRole("option", { name: "Kaos" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Kategori tidak dapat dimuat/)).toBeNull();
    });

    it("gives the category select the focus when Coba lagi goes with its error, and keeps it there", async () => {
      let calls = 0;
      const second = deferred<Response>();
      const user = userEvent.setup();
      renderCreate(() => {
        calls += 1;
        return calls === 1
          ? errorResponse(500, "INTERNAL_ERROR")
          : second.promise;
      });
      await screen.findByText(/Kategori tidak dapat dimuat\./);
      const retry = screen.getByRole("button", { name: "Coba lagi" });
      retry.focus();

      await user.keyboard("{Enter}");

      expect(
        await screen.findByRole("option", { name: "Memuat kategori…" }),
      ).toBeInTheDocument();
      expect(retry).not.toBeInTheDocument();
      expect(screen.getByLabelText("Kategori")).toHaveFocus();

      second.resolve(categoriesResponse(formCategories));

      expect(
        await screen.findByRole("option", { name: "Kaos" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Kategori")).toHaveFocus();
    });

    it("checks the step on Lanjut and focuses its first invalid field", async () => {
      const user = userEvent.setup();
      renderCreate();

      await user.click(screen.getByRole("button", { name: "Lanjut" }));

      const name = screen.getByLabelText("Nama produk");
      await waitFor(() => {
        expect(name).toHaveFocus();
      });
      expect(name).toHaveAccessibleDescription("Isi nama produk.");
      expect(screen.getByLabelText("Kategori")).toHaveAccessibleDescription(
        "Pilih kategori produk.",
      );
      expect(stepHeading("Info dasar")).toBeInTheDocument();
    });

    it("clears a field's error as soon as it is fixed", async () => {
      const user = userEvent.setup();
      renderCreate();
      await user.click(screen.getByRole("button", { name: "Lanjut" }));
      const name = screen.getByLabelText("Nama produk");
      await waitFor(() => {
        expect(name).toHaveAttribute("aria-invalid", "true");
      });

      await user.type(name, "K");

      await waitFor(() => {
        expect(name).not.toHaveAttribute("aria-invalid");
      });
    });

    it("moves on with Enter in a field, as Lanjut", async () => {
      const user = userEvent.setup();
      renderCreate();
      await screen.findByRole("option", { name: "Kaos" });
      await fillInfo(user);

      await user.type(screen.getByLabelText("Nama produk"), "{Enter}");

      await waitFor(() => {
        expect(stepHeading("Varian & harga")).toHaveFocus();
      });
      expect(screen.getByText("Langkah 2 dari 3")).toBeInTheDocument();
    });
  });

  describe("Varian & harga", () => {
    it("starts with one variant that cannot be removed", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toVariants(user);

      expect(screen.getAllByRole("group")).toHaveLength(1);
      expect(
        screen.getByRole("group", { name: "Varian 1" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Hapus/ })).toBeNull();
      expect(screen.getByText(/Total stok:/)).toHaveTextContent(
        "Total stok: 0 dari 1 varian.",
      );
      expect(screen.queryByText(/diarsipkan saat disimpan/)).toBeNull();
    });

    it("adds a variant with the focus on its SKU, and removing it focuses Tambah varian", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toVariants(user);

      await user.click(screen.getByRole("button", { name: "Tambah varian" }));

      const skus = screen.getAllByLabelText("SKU");
      expect(skus).toHaveLength(2);
      expect(skus[1]).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "Hapus Varian 2" }));

      expect(screen.getAllByLabelText("SKU")).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: "Tambah varian" }),
      ).toHaveFocus();
      expect(
        screen.getByText("Varian dihapus dari daftar."),
      ).toBeInTheDocument();
    });

    it("names a variant by its name and shows its stock level and the total", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toVariants(user);

      await fillVariant(user, 0, { name: "Merah", stock: "3" });
      await user.click(screen.getByRole("button", { name: "Tambah varian" }));
      await fillVariant(user, 1, { sku: "kph-l", name: "Biru", stock: "0" });

      expect(
        screen.getByRole("group", { name: /Varian 1: Merah/ }),
      ).toHaveTextContent("Stok menipis");
      expect(
        screen.getByRole("group", { name: /Varian 2: Biru/ }),
      ).toHaveTextContent("Stok habis");
      expect(screen.getByText(/Total stok:/)).toHaveTextContent(
        "Total stok: 3 dari 2 varian.",
      );
    });

    it("checks every variant on Lanjut and focuses the first invalid field", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toVariants(user);
      await fillVariant(user, 0, { price: "89,5" });

      await user.click(screen.getByRole("button", { name: "Lanjut" }));

      const price = screen.getByLabelText("Harga (Rp)");
      await waitFor(() => {
        expect(price).toHaveFocus();
      });
      expect(price).toHaveAccessibleDescription(
        "Tulis harga dalam rupiah tanpa koma, misalnya 89000 atau 89.000.",
      );
    });

    it("goes back to Info dasar with its values kept", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toVariants(user);

      await user.click(screen.getByRole("button", { name: "Kembali" }));

      expect(stepHeading("Info dasar")).toHaveFocus();
      expect(screen.getByLabelText("Nama produk")).toHaveValue(
        "Kaos Polos Hitam",
      );
      expect(screen.getByLabelText("Kategori")).toHaveValue(CATEGORY_ID);
    });
  });

  describe("jumping between steps", () => {
    it("validates every step on the way forward and stops at the first with an error", async () => {
      const user = userEvent.setup();
      renderCreate();
      await screen.findByRole("option", { name: "Kaos" });
      await fillInfo(user);

      await user.click(screen.getByRole("button", { name: /Tinjau/ }));

      // Info dasar is fine; the empty variant stops the jump on step 2.
      const sku = screen.getByLabelText("SKU");
      await waitFor(() => {
        expect(sku).toHaveFocus();
      });
      expect(stepHeading("Varian & harga")).toBeInTheDocument();
      expect(sku).toHaveAccessibleDescription(
        /Isi SKU varian, misalnya KPH-M\./,
      );
    });

    it("goes back without checking anything", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toVariants(user);

      await user.click(screen.getByRole("button", { name: /Info dasar/ }));

      expect(stepHeading("Info dasar")).toHaveFocus();
    });
  });

  describe("Tinjau", () => {
    it("shows what will be saved, parsed, and the photos note", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      const info = screen.getByRole("region", { name: "Info dasar" });
      expect(plain(info.textContent)).toContain(
        "NamaKaos Polos HitamSlugkaos-polos-hitamKategoriKaosStatusDrafDeskripsi—",
      );
      // The section and its scrolling table share the heading's name.
      const [variants] = screen.getAllByRole("region", { name: "Varian (1)" });
      if (variants === undefined) throw new Error("no variants section");
      const row = within(variants).getAllByRole("row")[1];
      expect(plain(row?.textContent)).toBe("KPH-MMRp 89.00012250 g");
      expect(
        screen.getByText(/Foto produk ditambahkan setelah produk tersimpan/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Buat produk" }),
      ).toBeInTheDocument();
    });

    it("goes back to a step from its Ubah", async () => {
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Ubah varian" }));
      expect(stepHeading("Varian & harga")).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "Lanjut" }));
      await waitFor(() => {
        expect(stepHeading("Tinjau")).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: "Ubah info dasar" }));

      expect(stepHeading("Info dasar")).toHaveFocus();
    });

    it("creates the product and opens its page, replacing /produk/baru, with a notice", async () => {
      const sent = recordRequests();
      server.use(createProductHandler(() => productResponse(created, 201)));
      const user = userEvent.setup();
      const { router } = renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      expect(
        await screen.findByRole("heading", {
          name: `Halaman /produk/${created.id}`,
        }),
      ).toBeInTheDocument();
      expect(router.state.historyAction).toBe("REPLACE");
      expect(
        screen.getByText(
          "Produk “Kaos Polos Hitam” tersimpan. Tambahkan fotonya di halaman ini.",
        ),
      ).toBeInTheDocument();
      const post = sent.find((request) => request.method === "POST");
      expect(post?.headers.get("Authorization")).toBe("Bearer token-1");
      expect(await post?.json()).toEqual({
        category_id: CATEGORY_ID,
        slug: "kaos-polos-hitam",
        name: "Kaos Polos Hitam",
        description: "",
        status: "draft",
        variants: [
          {
            sku: "KPH-M",
            name: "M",
            price: 89_000,
            stock: 12,
            weight_grams: 250,
          },
        ],
      });
    });

    it("says 'Menyimpan…' on a disabled button while it saves", async () => {
      const answer = deferred<Response>();
      server.use(createProductHandler(() => answer.promise));
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      expect(
        await screen.findByRole("button", { name: "Menyimpan…" }),
      ).toBeDisabled();
      answer.resolve(productResponse(created, 201));
      expect(
        await screen.findByRole("heading", {
          name: `Halaman /produk/${created.id}`,
        }),
      ).toBeInTheDocument();
    });

    it("takes the seller back to a field the API refused, on its step, focused", async () => {
      server.use(createProductHandler(() => errorResponse(409, "SLUG_TAKEN")));
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      const slug = await screen.findByLabelText("Slug");
      await waitFor(() => {
        expect(slug).toHaveFocus();
      });
      expect(slug).toHaveAccessibleDescription(
        /Slug ini sudah dipakai produk lain\. Pilih slug lain\./,
      );
      expect(stepHeading("Info dasar")).toBeInTheDocument();
    });

    it("goes to the earliest step the API's field errors are on", async () => {
      server.use(
        createProductHandler(() =>
          errorResponse(400, "VALIDATION_FAILED", {
            details: { "variants[0].weight_grams": "must be at most 100000" },
          }),
        ),
      );
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      const weight = await screen.findByLabelText("Berat (gram)");
      await waitFor(() => {
        expect(weight).toHaveFocus();
      });
      expect(weight).toHaveAccessibleDescription("Paling besar 100.000.");
    });

    it("with errors on both steps, goes to the first and focuses its field", async () => {
      server.use(
        createProductHandler(() =>
          errorResponse(400, "VALIDATION_FAILED", {
            details: {
              "variants[0].price": "must be at least 1",
              slug: "is invalid",
            },
          }),
        ),
      );
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      const slug = await screen.findByLabelText("Slug");
      await waitFor(() => {
        expect(slug).toHaveFocus();
      });
      expect(slug).toHaveAccessibleDescription(/Isinya tidak valid\./);
      await user.click(screen.getByRole("button", { name: "Lanjut" }));
      expect(
        await screen.findByLabelText("Harga (Rp)"),
      ).toHaveAccessibleDescription("Minimal 1.");
    });

    it("shows SKU_TAKEN on the variant list", async () => {
      server.use(createProductHandler(() => errorResponse(409, "SKU_TAKEN")));
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /Salah satu SKU sudah dipakai varian lain di toko/,
      );
      expect(stepHeading("Varian & harga")).toBeInTheDocument();
    });

    it("says why a save failed above the button, focused, and lets the seller try again", async () => {
      let calls = 0;
      server.use(
        createProductHandler(() => {
          calls += 1;
          return calls === 1
            ? errorResponse(500, "INTERNAL_ERROR")
            : productResponse(created, 201);
        }),
      );
      const user = userEvent.setup();
      renderCreate();
      await toReview(user);

      await user.click(screen.getByRole("button", { name: "Buat produk" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Produk belum tersimpan karena kesalahan di server. Coba lagi.",
      );
      await waitFor(() => {
        expect(alert).toHaveFocus();
      });
      await user.click(screen.getByRole("button", { name: "Buat produk" }));
      expect(
        await screen.findByRole("heading", {
          name: `Halaman /produk/${created.id}`,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("leaving with unsaved changes", () => {
    it("lets an untouched form leave at once", async () => {
      const user = userEvent.setup();
      const { router } = renderCreate();

      await user.click(screen.getByRole("link", { name: "Batal" }));

      expect(router.state.location.pathname).toBe("/produk");
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("asks first, stays on 'Tetap di sini' and leaves on 'Tinggalkan'", async () => {
      const user = userEvent.setup();
      const { router } = renderCreate();
      await user.type(screen.getByLabelText("Nama produk"), "Kaos");

      await user.click(screen.getByRole("link", { name: "Batal" }));
      const dialog = screen.getByRole("alertdialog", {
        name: "Tinggalkan halaman ini?",
      });
      expect(dialog).toHaveAttribute("open");
      await user.click(
        within(dialog).getByRole("button", { name: "Tetap di sini" }),
      );

      expect(router.state.location.pathname).toBe("/produk/baru");
      expect(dialog).not.toHaveAttribute("open");
      expect(screen.getByLabelText("Nama produk")).toHaveValue("Kaos");

      await user.click(screen.getByRole("link", { name: "Batal" }));
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Tinggalkan",
        }),
      );
      expect(router.state.location.pathname).toBe("/produk");
    });
  });
});
