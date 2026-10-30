import { getAdminProduct, updateProduct } from "@goshop/shared";
import type { AdminProduct, ProductWrite } from "@goshop/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import userEvent from "@testing-library/user-event";
import { delay } from "msw";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api.ts";
import {
  CATEGORY_ID,
  PRODUCT_ID,
  adminProduct,
  adminVariant,
  category,
} from "@/test/fixtures.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  categoriesHandler,
  productDetailHandler,
  productResponse,
  updateProductHandler,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { renderRoute } from "@/test/render.tsx";
import { productToFormValues } from "../product-form.ts";
import { ProductForm } from "./ProductForm.tsx";

// ProductForm's artikel 05 behaviour: the PUT carries the versions, a 409
// opens the review of what changed, and the page's refetched product is
// followed while the form is untouched.

const M = adminVariant(1, { name: "M", sku: "KAOS-M", stock: 12 });
const loadedProduct = adminProduct({
  version: 4,
  variants: [{ ...M, version: 2 }],
});

let setLatest: (product: AdminProduct) => void = () => undefined;
const register = (set: (product: AdminProduct) => void) => {
  setLatest = set;
};

/** The edit page's part: the product query's latest copy, as a prop. */
function Harness({
  loaded,
  onSaved,
}: {
  loaded: AdminProduct;
  onSaved: (product: AdminProduct) => void;
}) {
  const [latest, set] = useState<AdminProduct>();
  useEffect(() => {
    register(set);
  }, []);
  return (
    <ProductForm
      mode="edit"
      defaultValues={productToFormValues(loaded)}
      onSave={(body: ProductWrite) => updateProduct(api, PRODUCT_ID, body)}
      onSaved={onSaved}
      loadLatest={() => getAdminProduct(api, PRODUCT_ID)}
      latest={latest}
      cancelTo="/produk"
    />
  );
}

/** The form on an edit page: PUT and GET through MSW. */
const renderForm = ({
  loaded = loadedProduct,
}: { loaded?: AdminProduct } = {}) => {
  server.use(categoriesHandler([category(CATEGORY_ID, "Kaos")]));
  const onSaved = vi.fn<(product: AdminProduct) => void>();
  const view = renderRoute(<Harness loaded={loaded} onSaved={onSaved} />, {
    path: "/produk/:id",
    url: `/produk/${PRODUCT_ID}`,
  });
  /** The page's query refetched: the form gets this as `latest`. */
  const refetched = (product: AdminProduct) => {
    act(() => {
      setLatest(product);
    });
  };
  return { ...view, onSaved, user: userEvent.setup(), refetched };
};

/** Changes the name, then walks to "Tinjau" and saves. */
const editNameAndSave = async (
  user: ReturnType<typeof userEvent.setup>,
  name = "Kaos Oblong",
) => {
  const field = await screen.findByLabelText("Nama produk");
  await user.clear(field);
  await user.type(field, name);
  await user.click(screen.getByRole("button", { name: "Lanjut" }));
  await user.click(await screen.findByRole("button", { name: "Lanjut" }));
  await user.click(
    await screen.findByRole("button", { name: "Simpan perubahan" }),
  );
};

const reviewHeading = () =>
  screen.findByRole("heading", {
    name: "Produk ini berubah sejak Anda membukanya",
  });

describe("ProductForm, artikel 05", () => {
  it("sends the product's version and each variant's with the PUT", async () => {
    const sent = recordRequests();
    server.use(updateProductHandler(() => productResponse(loadedProduct)));
    const { user, onSaved } = renderForm();

    await editNameAndSave(user);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    const body = (await sent
      .find((r) => r.method === "PUT")
      ?.json()) as ProductWrite;
    expect(body.version).toBe(4);
    expect(body.variants.map(({ id, version }) => [id, version])).toEqual([
      [M.id, 2],
    ]);
    expect(body.name).toBe("Kaos Oblong");
  });

  it("opens the review after a product conflict, with what the server has now", async () => {
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { product_id: PRODUCT_ID },
        }),
      ),
      productDetailHandler({
        ...loadedProduct,
        version: 5,
        description: "Dari server.",
      }),
    );
    const { user } = renderForm();

    await editNameAndSave(user);

    expect(await reviewHeading()).toHaveFocus();
    expect(
      screen.getByText(/admin lain menyimpan atau mengarsipkan produk ini/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Simpan perubahan" }),
    ).toBeNull();
  });

  it("applies the seller's changes to the latest product, then saves with the latest version", async () => {
    const sent = recordRequests();
    let puts = 0;
    server.use(
      updateProductHandler(() => {
        puts += 1;
        return puts === 1
          ? errorResponse(409, "VERSION_CONFLICT", {
              details: { product_id: PRODUCT_ID },
            })
          : productResponse(loadedProduct);
      }),
      productDetailHandler({
        ...loadedProduct,
        version: 5,
        description: "Dari server.",
        variants: [{ ...M, version: 3, stock: 10 }],
      }),
    );
    const { user, onSaved } = renderForm();
    await editNameAndSave(user);
    await reviewHeading();

    await user.click(
      screen.getByRole("button", {
        name: "Terapkan perubahan saya ke data terbaru",
      }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Tinjau" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Perubahan Anda diterapkan ke data terbaru. Periksa hasilnya, lalu simpan.",
    );
    await user.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    const body = (await sent
      .filter((r) => r.method === "PUT")[1]
      ?.json()) as ProductWrite;
    expect(body).toMatchObject({
      version: 5,
      name: "Kaos Oblong",
      description: "Dari server.",
    });
    expect(body.variants).toEqual([
      expect.objectContaining({ id: M.id, version: 3, stock: 10 }),
    ]);
  });

  it("makes the latest product the new starting point: a variant archived on the server is not 'archived on save'", async () => {
    const L = adminVariant(2, { name: "L", sku: "KAOS-L", stock: 4 });
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { product_id: PRODUCT_ID },
        }),
      ),
      productDetailHandler({
        ...loadedProduct,
        version: 5,
        variants: [{ ...M, version: 2 }],
      }),
    );
    const { user } = renderForm({
      loaded: {
        ...loadedProduct,
        variants: [
          { ...M, version: 2 },
          { ...L, version: 1 },
        ],
      },
    });
    await editNameAndSave(user);
    await reviewHeading();

    await user.click(
      screen.getByRole("button", {
        name: "Terapkan perubahan saya ke data terbaru",
      }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Tinjau" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Varian (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^Diarsipkan saat disimpan/ }),
    ).toBeNull();
  });

  it("drops the seller's changes on request, back at the first step with the latest values", async () => {
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { product_id: PRODUCT_ID },
        }),
      ),
      productDetailHandler({
        ...loadedProduct,
        version: 5,
        name: "Nama Server",
      }),
    );
    const { user } = renderForm();
    await editNameAndSave(user);
    await reviewHeading();

    await user.click(
      screen.getByRole("button", { name: "Buang perubahan saya" }),
    );

    expect(
      await screen.findByRole("heading", { level: 2, name: "Info dasar" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nama produk")).toHaveValue("Nama Server");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Perubahan Anda dibuang. Formulir berisi data terbaru.",
    );
  });

  it("names the variant whose stock moved, for a variant conflict", async () => {
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { variant_id: M.id },
        }),
      ),
      productDetailHandler({
        ...loadedProduct,
        variants: [{ ...M, version: 3, stock: 10 }],
      }),
    );
    const { user } = renderForm();

    await editNameAndSave(user);

    await reviewHeading();
    expect(
      screen.getByText(/stok varian di bawah berubah di server/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Server menolak penyimpanan karena stok varian ini berubah.",
      ),
    ).toBeInTheDocument();
  });

  it("explains VARIANT_ARCHIVED as an archived variant", async () => {
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VARIANT_ARCHIVED", {
          details: { variant_id: M.id },
        }),
      ),
      productDetailHandler({ ...loadedProduct, version: 5, variants: [] }),
    );
    const { user } = renderForm();

    await editNameAndSave(user);

    await reviewHeading();
    expect(
      screen.getByText(
        /Formulir Anda masih memuat varian yang di server sudah diarsipkan/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/menimpa perubahan itu/)).toBeNull();
  });

  it("keeps the focus on the review's heading when the latest product arrives late", async () => {
    // A real refetch takes time: the review opens while loading, and the
    // product arrives under the same heading.
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { product_id: PRODUCT_ID },
        }),
      ),
      productDetailHandler(async () => {
        await delay(100);
        return productResponse({
          ...loadedProduct,
          version: 5,
          description: "Dari server.",
        });
      }),
    );
    const { user } = renderForm();

    await editNameAndSave(user);
    expect(await reviewHeading()).toHaveFocus();
    expect(
      screen.getByText("Memuat data terbaru dari server…"),
    ).toBeInTheDocument();

    expect(await screen.findByText(/admin lain menyimpan/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Produk ini berubah sejak Anda membukanya",
      }),
    ).toHaveFocus();
  });

  it("offers to fetch the latest product again when that fails", async () => {
    let gets = 0;
    server.use(
      updateProductHandler(() =>
        errorResponse(409, "VERSION_CONFLICT", {
          details: { product_id: PRODUCT_ID },
        }),
      ),
      productDetailHandler(() => {
        gets += 1;
        return gets === 1
          ? errorResponse(500, "INTERNAL_ERROR")
          : productResponse({ ...loadedProduct, version: 5 });
      }),
    );
    const { user } = renderForm();
    await editNameAndSave(user);

    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(
      await screen.findByRole("button", {
        name: "Terapkan perubahan saya ke data terbaru",
      }),
    ).toBeInTheDocument();
    expect(gets).toBe(2);
    // The button went with the error; the focus did not fall to <body>.
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Produk ini berubah sejak Anda membukanya",
      }),
    ).toHaveFocus();
  });

  it("follows the page's refetched product while the form is untouched", async () => {
    const { refetched } = renderForm();
    await screen.findByLabelText("Nama produk");

    refetched({ ...loadedProduct, version: 5, name: "Nama Server" });

    await waitFor(() => {
      expect(screen.getByLabelText("Nama produk")).toHaveValue("Nama Server");
    });
    expect(screen.queryByText(/Produk ini berubah di server/)).toBeNull();
  });

  it("keeps the seller's changes and says the server moved, once the form is touched", async () => {
    const { refetched, user } = renderForm();
    const field = await screen.findByLabelText("Nama produk");
    await user.clear(field);
    await user.type(field, "Punya Saya");

    refetched({ ...loadedProduct, version: 5, name: "Nama Server" });

    expect(
      await screen.findByText(
        /Produk ini berubah di server sejak Anda mulai mengubahnya/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nama produk")).toHaveValue("Punya Saya");
  });

  it("says nothing when the refetched product is what the form loaded", async () => {
    const { refetched, user } = renderForm();
    const field = await screen.findByLabelText("Nama produk");
    await user.type(field, "!");

    refetched(loadedProduct);

    expect(screen.queryByText(/Produk ini berubah di server/)).toBeNull();
  });
});
