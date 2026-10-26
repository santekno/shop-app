import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  deferred,
  errorResponse,
  fetchMock,
} from "@/test/fake-api.ts";
import { CategorySection } from "./CategorySection.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
});

describe("CategorySection", () => {
  it("shows a loading status while the request runs", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));

    render(<CategorySection />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Kategori" }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Memuat kategori…");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the categories as a tree once they arrive", async () => {
    fetchMock.mockResolvedValue(
      categoriesResponse([
        category("1", "Pakaian"),
        category("2", "Kaos", "1"),
      ]),
    );

    render(<CategorySection />);

    expect(await screen.findByText("Kaos")).toBeTruthy();
    expect(screen.getByText("Pakaian")).toBeTruthy();
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so when there are no categories", async () => {
    fetchMock.mockResolvedValue(categoriesResponse([]));

    render(<CategorySection />);

    expect(await screen.findByText("Belum ada kategori.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the error message and the request ID in an alert", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR", "req-42"));

    render(<CategorySection />);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeTruthy();
    expect(alert.textContent).toContain("Kode permintaan: req-42");
    expect(within(alert).getByText("req-42").tagName).toBe("CODE");
    expect(
      within(alert).getByRole("button", { name: "Coba lagi" }),
    ).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves the request ID out when there is none", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    render(<CategorySection />);

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
      ),
    ).toBeTruthy();
    expect(alert.textContent).not.toContain("Kode permintaan");
    expect(alert.querySelector("code")).toBeNull();
  });

  it("loads again when Coba lagi is pressed", async () => {
    const user = userEvent.setup();
    const answer = deferred<Response>();
    fetchMock
      .mockResolvedValueOnce(errorResponse(503, "INTERNAL_ERROR"))
      .mockImplementationOnce(() => answer.promise);

    render(<CategorySection />);
    await user.click(await screen.findByRole("button", { name: "Coba lagi" }));

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    answer.resolve(categoriesResponse([category("1", "Pakaian")]));
    expect(await screen.findByText("Pakaian")).toBeTruthy();
  });
});
