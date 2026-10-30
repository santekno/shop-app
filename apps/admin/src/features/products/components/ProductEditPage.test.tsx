import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AdminProduct } from "@goshop/shared";
import { PRODUCT_ID, adminProduct, adminVariant } from "@/test/fixtures.ts";
import { errorResponse, recordRequests } from "@/test/msw/http.ts";
import {
  archiveProductHandler,
  categoriesHandler,
  productDetailHandler,
  productResponse,
  updateProductHandler,
} from "@/test/msw/products.ts";
import { server } from "@/test/msw/server.ts";
import { formCategories, stepHeading } from "@/test/products-form.ts";
import { renderRoutes } from "@/test/render.tsx";
import { ProductEditPage } from "./ProductEditPage.tsx";

const renderEdit = (
  answer: Parameters<typeof productDetailHandler>[0] = adminProduct(),
  url: string | { pathname: string; state: unknown } = `/produk/${PRODUCT_ID}`,
) => {
  server.use(categoriesHandler(formCategories), productDetailHandler(answer));
  return renderRoutes(
    [
      {
        path: "/produk/:productId",
        element: (
          <main id="konten" tabIndex={-1}>
            <ProductEditPage />
          </main>
        ),
      },
      { path: "/produk", element: <h1>Daftar produk</h1> },
    ],
    { url: url as string },
  );
};

const header = () => {
  const block = screen.getByRole("heading", {
    level: 1,
    name: "Ubah produk",
  }).parentElement;
  if (block === null) throw new Error("no header");
  return block;
};

describe("ProductEditPage", () => {
  it("says it is loading, then shows the product's name, status and form", async () => {
    renderEdit();

    expect(screen.getByText("Memuat produk…")).toBeInTheDocument();
    expect(await screen.findByLabelText("Nama produk")).toHaveValue(
      "Kaos Polos",
    );
    expect(within(header()).getByText("Kaos Polos")).toBeInTheDocument();
    expect(within(header()).getByText("Aktif")).toBeInTheDocument();
    expect(document.title).toBe("Kaos Polos — GoShop Admin");
    expect(
      screen.getByRole("button", { name: "Arsipkan" }),
    ).toBeInTheDocument();
  });

  it("says the product was not found, with the way back", async () => {
    renderEdit(() => errorResponse(404, "NOT_FOUND"));

    expect(
      await screen.findByText(
        "Produk ini tidak ditemukan. Mungkin alamatnya salah ketik.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Kembali ke daftar produk" }),
    ).toHaveAttribute("href", "/produk");
    expect(document.title).toBe("Ubah produk — GoShop Admin");
  });

  it("offers to try again after another failure", async () => {
    let calls = 0;
    const user = userEvent.setup();
    renderEdit(() => {
      calls += 1;
      return calls === 1
        ? errorResponse(500, "INTERNAL_ERROR")
        : productResponse(adminProduct());
    });

    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(await screen.findByLabelText("Nama produk")).toHaveValue(
      "Kaos Polos",
    );
  });

  it("shows the create page's notice once, and forgets it in the history entry", async () => {
    const { router } = renderEdit(adminProduct(), {
      pathname: `/produk/${PRODUCT_ID}`,
      state: { notice: "Produk “Kaos Polos” tersimpan." },
    });

    expect(
      screen.getByText("Produk “Kaos Polos” tersimpan."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.state).toBeNull();
    });
    expect(router.state.historyAction).toBe("REPLACE");
    expect(
      screen.getByText("Produk “Kaos Polos” tersimpan."),
    ).toBeInTheDocument();
  });

  it("ignores history state that is not a notice", async () => {
    const { router } = renderEdit(adminProduct(), {
      pathname: `/produk/${PRODUCT_ID}`,
      state: { notice: 3 },
    });

    await screen.findByLabelText("Nama produk");
    expect(router.state.historyAction).toBe("POP");
  });

  it("saves with the loaded versions and says so", async () => {
    const sent = recordRequests();
    const saved = adminProduct({ name: "Kaos Polos Baru", version: 2 });
    server.use(updateProductHandler(() => productResponse(saved)));
    const user = userEvent.setup();
    renderEdit(
      adminProduct({ version: 1, variants: [adminVariant(1, { version: 5 })] }),
    );
    const name = await screen.findByLabelText("Nama produk");
    await screen.findByRole("option", { name: "Kaos" });

    await user.clear(name);
    await user.type(name, "Kaos Polos Baru");
    await user.click(screen.getByRole("button", { name: /Tinjau/ }));
    await waitFor(() => {
      expect(stepHeading("Tinjau")).toHaveFocus();
    });
    await user.click(screen.getByRole("button", { name: "Simpan perubahan" }));

    expect(
      await screen.findByText("Perubahan pada “Kaos Polos Baru” tersimpan."),
    ).toBeInTheDocument();
    const put = sent.find((request) => request.method === "PUT");
    expect(put?.url.pathname).toBe(`/v1/admin/products/${PRODUCT_ID}`);
    expect(await put?.json()).toMatchObject({
      version: 1,
      name: "Kaos Polos Baru",
      variants: [{ id: adminVariant(1).id, version: 5 }],
    });
  });

  it("shows an archived product's badge and offers no archive", async () => {
    renderEdit(adminProduct({ status: "archived" }));

    await screen.findByLabelText("Nama produk");
    expect(within(header()).getByText("Diarsipkan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arsipkan" })).toBeNull();
  });

  it("after an archive: says so, starts the form over from the archived product, and focuses the page's heading", async () => {
    let archived = false;
    const product = (): AdminProduct =>
      adminProduct({ status: archived ? "archived" : "active" });
    server.use(
      archiveProductHandler(() => {
        archived = true;
        return new Response(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderEdit(() => productResponse(product()));
    const name = await screen.findByLabelText("Nama produk");
    await user.type(name, " diubah");

    await user.click(screen.getByRole("button", { name: "Arsipkan" }));
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "Arsipkan “Kaos Polos”?" }),
      ).getByRole("button", { name: "Arsipkan" }),
    );

    expect(
      await screen.findByText(
        /Produk diarsipkan dan tidak tampil lagi di toko\./,
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Ubah produk" }),
      ).toHaveFocus();
    });
    expect(within(header()).getByText("Diarsipkan")).toBeInTheDocument();
    expect(screen.getByLabelText("Nama produk")).toHaveValue("Kaos Polos");
    expect(screen.getByLabelText("Status")).toHaveValue("archived");
  });
});
