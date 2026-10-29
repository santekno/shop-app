import { describe, expect, it, vi } from "vitest";
import { createAddress, listAddresses } from "./addresses.ts";
import { createApiClient } from "./client.ts";
import { isApiError } from "./errors.ts";
import type { Address, AddressCreate } from "./types.ts";

const rumah: Address = {
  id: "a1",
  label: "Rumah",
  recipient_name: "Budi Santoso",
  phone: "081234567890",
  street: "Jl. Merdeka No. 1, RT 01/RW 02",
  city: "Bandung",
  province: "Jawa Barat",
  postal_code: "40111",
  is_default: true,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

const setup = (response: () => Response, retries = 0) => {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  const api = createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchMock,
    retries,
  });
  const call = () => {
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    return { url: typeof input === "string" ? input : "", init };
  };
  return { api, fetchMock, call };
};

const apiError = (status: number, code: string, details?: object) =>
  Response.json({ error: { code, message: "boom", details } }, { status });

describe("listAddresses", () => {
  it("GETs /v1/me/addresses and returns the list", async () => {
    const kantor = { ...rumah, id: "a2", label: "Kantor", is_default: false };
    const { api, call } = setup(() => Response.json({ data: [rumah, kantor] }));

    await expect(listAddresses(api)).resolves.toEqual([rumah, kantor]);

    expect(call().url).toBe("http://api.test/v1/me/addresses");
    expect(call().init?.method).toBe("GET");
  });

  it("returns an empty list for a buyer with no address yet", async () => {
    const { api } = setup(() => Response.json({ data: [] }));

    await expect(listAddresses(api)).resolves.toEqual([]);
  });

  it("throws UNAUTHORIZED without a valid access token", async () => {
    const { api } = setup(() => apiError(401, "UNAUTHORIZED"));

    const error: unknown = await listAddresses(api).catch((e: unknown) => e);
    expect(isApiError(error, "UNAUTHORIZED")).toBe(true);
  });

  it("passes the caller's signal on", async () => {
    const { api, call } = setup(() => Response.json({ data: [] }));
    const controller = new AbortController();

    const pending = listAddresses(api, { signal: controller.signal });
    controller.abort();

    expect(call().init?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});

describe("createAddress", () => {
  const address: AddressCreate = {
    label: "Rumah",
    recipient_name: "Budi Santoso",
    phone: "081234567890",
    street: "Jl. Merdeka No. 1, RT 01/RW 02",
    city: "Bandung",
    province: "Jawa Barat",
    postal_code: "40111",
    is_default: true,
  };

  it("POSTs the address as JSON and returns the stored one", async () => {
    const { api, call } = setup(() =>
      Response.json({ data: rumah }, { status: 201 }),
    );

    await expect(createAddress(api, address)).resolves.toEqual(rumah);

    expect(call().url).toBe("http://api.test/v1/me/addresses");
    expect(call().init?.method).toBe("POST");
    expect(JSON.parse(call().init?.body as string)).toEqual(address);
    expect(new Headers(call().init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("throws ADDRESS_LIMIT_REACHED once, never retrying the POST", async () => {
    const { api, fetchMock } = setup(
      () => apiError(409, "ADDRESS_LIMIT_REACHED"),
      3,
    );

    const error: unknown = await createAddress(api, address).catch(
      (e: unknown) => e,
    );

    expect(isApiError(error, "ADDRESS_LIMIT_REACHED")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws VALIDATION_FAILED with the API's details per field", async () => {
    const { api } = setup(() =>
      apiError(422, "VALIDATION_FAILED", {
        fields: [{ field: "postal_code", message: "invalid" }],
      }),
    );

    const error: unknown = await createAddress(api, address).catch(
      (e: unknown) => e,
    );

    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      details: { fields: [{ field: "postal_code", message: "invalid" }] },
    });
  });

  it("passes the caller's signal on", async () => {
    const { api, call } = setup(() => Response.json({ data: rumah }));
    const controller = new AbortController();

    const pending = createAddress(api, address, { signal: controller.signal });
    controller.abort();

    expect(call().init?.signal?.aborted).toBe(true);
    await pending.catch(() => undefined);
  });
});
