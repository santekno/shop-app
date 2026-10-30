import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdminProduct, ProductInput, ProductWrite } from "@goshop/shared";
import { CATEGORY_ID, adminProduct, adminVariant } from "@/test/fixtures.ts";
import { categoriesHandler } from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { formCategories, stepHeading } from "@/test/products-form.ts";
import { renderRoute } from "@/test/render.tsx";
import { productToFormValues } from "../product-form.ts";
import { ProductForm } from "./ProductForm.tsx";
import type { ProductFormMode } from "./ProductForm.tsx";

// ProductForm with its props set directly: the cases its pages cannot
// reach easily (50 variants, an unknown category, the edit wording).
// The create and edit pages' tests cover the whole flow.

const renderForm = ({
  mode = "edit",
  defaultValues = productToFormValues(adminProduct()),
  onSave = vi.fn<(body: ProductWrite) => Promise<AdminProduct>>(() =>
    Promise.resolve(adminProduct()),
  ),
  onSaved = vi.fn<(product: AdminProduct) => void>(),
}: {
  mode?: ProductFormMode;
  defaultValues?: ProductInput;
  onSave?: (body: ProductWrite) => Promise<AdminProduct>;
  onSaved?: (product: AdminProduct) => void;
} = {}) => {
  server.use(categoriesHandler(formCategories));
  const view = renderRoute(
    <ProductForm
      mode={mode}
      defaultValues={defaultValues}
      onSave={onSave}
      onSaved={onSaved}
      cancelTo="/produk"
    />,
    { path: "/produk/:productId", url: "/produk/p-1" },
  );
  return { ...view, onSave, onSaved };
};

const toStep = async (
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) => {
  await user.click(screen.getByRole("button", { name: new RegExp(title) }));
  await waitFor(() => {
    expect(stepHeading(title)).toHaveFocus();
  });
};

describe("ProductForm", () => {
  it("in edit mode, warns about changing the slug and does not make it from the name", async () => {
    const user = userEvent.setup();
    renderForm();
    const slug = screen.getByLabelText("Slug");

    await user.type(screen.getByLabelText("Nama produk"), " Baru");

    expect(slug).toHaveValue("kaos-polos");
    expect(slug).toHaveAccessibleDescription(
      /tautan lama ke produk ini tidak berfungsi lagi/,
    );
    expect(screen.getByLabelText("Status")).toHaveValue("active");
    expect(
      await screen.findByRole("option", { name: "Kaos" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Kategori")).toHaveValue(CATEGORY_ID);
  });

  it("keeps a category the list no longer has selectable, named as unknown", async () => {
    const gone = "99999999-9999-4999-8999-000000000009";
    renderForm({
      defaultValues: {
        ...productToFormValues(adminProduct()),
        category_id: gone,
      },
    });

    const unknown = await screen.findByRole("option", {
      name: "Kategori tidak dikenal",
    });
    expect(unknown).toHaveValue(gone);
    expect(screen.getByLabelText("Kategori")).toHaveValue(gone);
  });

  it("says an edited variant removed will be archived, in the text and when it goes", async () => {
    const user = userEvent.setup();
    renderForm({
      defaultValues: productToFormValues(
        adminProduct({
          variants: [adminVariant(1), adminVariant(2, { sku: "KAOS-2" })],
        }),
      ),
    });
    await toStep(user, "Varian & harga");

    expect(
      screen.getByText(
        /Varian yang dihapus dari daftar diarsipkan saat disimpan/,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hapus Varian 2" }));

    expect(
      screen.getByText(
        "Varian dihapus dari daftar dan akan diarsipkan saat disimpan.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("SKU")).toHaveLength(1);
  });

  it("stops adding at 50 variants and says why", async () => {
    const user = userEvent.setup();
    const fifty = Array.from({ length: 50 }, (_, i) =>
      adminVariant(i + 1, { sku: `S-${String(i)}` }),
    );
    renderForm({
      defaultValues: productToFormValues(adminProduct({ variants: fifty })),
    });
    await toStep(user, "Varian & harga");

    expect(
      screen.getByRole("button", { name: "Tambah varian" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Paling banyak 50 varian per produk."),
    ).toBeInTheDocument();
  });

  it("allows adding below 50, without the note", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 49 }, (_, i) =>
      adminVariant(i + 1, { sku: `S-${String(i)}` }),
    );
    renderForm({
      defaultValues: productToFormValues(adminProduct({ variants: many })),
    });
    await toStep(user, "Varian & harga");

    expect(screen.getByRole("button", { name: "Tambah varian" })).toBeEnabled();
    expect(
      screen.queryByText("Paling banyak 50 varian per produk."),
    ).toBeNull();
  });

  it("shows the description and the status label in Tinjau, without the photos note", async () => {
    const user = userEvent.setup();
    renderForm({
      defaultValues: {
        ...productToFormValues(
          adminProduct({ description: "Baris satu\nBaris dua" }),
        ),
      },
    });
    await toStep(user, "Tinjau");

    const info = screen.getByRole("region", { name: "Info dasar" });
    expect(within(info).getByText(/Baris satu/)).toHaveTextContent(
      "Baris satu Baris dua",
    );
    expect(within(info).getByText("Aktif")).toBeInTheDocument();
    expect(screen.queryByText(/Foto produk ditambahkan/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Simpan perubahan" }),
    ).toBeInTheDocument();
  });

  it("says what is still wrong in Tinjau when a value no step checks is invalid, and does not save it", async () => {
    // `version` has no input and belongs to no step, so the steps let the
    // seller through and only the whole-form check refuses it.
    const user = userEvent.setup();
    const { onSave } = renderForm({
      defaultValues: { ...productToFormValues(adminProduct()), version: -1 },
    });
    await toStep(user, "Tinjau");

    expect(
      screen.getByText(/Masih ada isian yang belum benar\./),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Simpan perubahan" }));

    // No step holds the error: the form shows the variants step.
    await waitFor(() => {
      expect(stepHeading("Varian & harga")).toHaveFocus();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the parsed body with the versions, then calls onSaved with the answer", async () => {
    const user = userEvent.setup();
    const saved = adminProduct({ version: 2, name: "Kaos Polos" });
    const { onSave, onSaved } = renderForm({
      onSave: vi.fn(() => Promise.resolve(saved)),
    });
    await toStep(user, "Tinjau");

    await user.click(screen.getByRole("button", { name: "Simpan perubahan" }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved);
    });
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      category_id: CATEGORY_ID,
      slug: "kaos-polos",
      name: "Kaos Polos",
      description: "Kaos katun.",
      status: "active",
      variants: [
        {
          id: adminVariant(1).id,
          version: 1,
          sku: "KAOS-1",
          name: "Varian 1",
          price: 89_000,
          stock: 12,
          weight_grams: 250,
        },
      ],
    });
  });

  it("asks nothing before leaving once the save made the form clean", async () => {
    const user = userEvent.setup();
    const { router } = renderForm();
    await user.type(screen.getByLabelText("Nama produk"), " Baru");
    await toStep(user, "Tinjau");

    await user.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Simpan perubahan" }),
      ).toBeEnabled();
    });
    await router.navigate("/produk");

    expect(router.state.location.pathname).toBe("/produk");
    expect(
      screen.queryByRole("alertdialog", { name: "Tinggalkan halaman ini?" }),
    ).toBeNull();
  });
});
