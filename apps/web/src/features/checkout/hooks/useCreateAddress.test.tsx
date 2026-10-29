import { act, renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { AddressCreate } from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/features/auth/session-context.ts";
import {
  address,
  addressResponse,
  addressesResponse,
} from "@/test/checkout-fixtures.ts";
import {
  deferred,
  errorResponse,
  fetchMock,
  requestUrl,
  user,
} from "@/test/fake-api.ts";
import { createTestQueryClient, hookWrapper } from "@/test/render.tsx";
import { addressesQuery } from "../api/queries.ts";
import { useCreateAddress } from "./useCreateAddress.ts";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const session = { user: user({ id: "u1" }), accessToken: "a" };

const input: AddressCreate = {
  label: "Kantor",
  recipient_name: "Budi Santoso",
  phone: "081234567890",
  street: "Jl. Asia Afrika 8",
  city: "Bandung",
  province: "Jawa Barat",
  postal_code: "40111",
  is_default: false,
};

/** The hook next to the address list a page would show. */
const useCreateWithList = () => {
  const { authApi } = useSession();
  return {
    create: useCreateAddress("u1"),
    list: useQuery(addressesQuery(authApi, "u1")),
  };
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useCreateAddress", () => {
  it("POSTs the address and settles only once the list has it", async () => {
    const refetch = deferred<Response>();
    let listRequests = 0;
    fetchMock.mockImplementation((request, init) => {
      if (init?.method === "POST") {
        return Promise.resolve(addressResponse(address("a2")));
      }
      listRequests += 1;
      return listRequests === 1
        ? Promise.resolve(addressesResponse([address("a1")]))
        : refetch.promise;
    });
    const { result } = renderHook(useCreateWithList, {
      wrapper: hookWrapper(createTestQueryClient(), "/checkout", session),
    });
    await waitFor(() => {
      expect(result.current.list.data).toHaveLength(1);
    });

    act(() => {
      result.current.create.mutate(input);
    });
    await waitFor(() => {
      expect(listRequests).toBe(2);
    });
    // Created, but the list has not come back yet: still pending.
    expect(result.current.create.isPending).toBe(true);

    await act(async () => {
      refetch.resolve(addressesResponse([address("a1"), address("a2")]));
      await refetch.promise;
    });
    await waitFor(() => {
      expect(result.current.create.isSuccess).toBe(true);
    });

    expect(result.current.create.data?.id).toBe("a2");
    expect(result.current.list.data?.map((a) => a.id)).toEqual(["a1", "a2"]);
    const post = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(requestUrl(post?.[0] ?? "").pathname).toBe("/v1/me/addresses");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual(input);
  });

  it("fails without refetching the list", async () => {
    fetchMock.mockResolvedValue(errorResponse(409, "ADDRESS_LIMIT_REACHED"));
    const { result } = renderHook(() => useCreateAddress("u1"), {
      wrapper: hookWrapper(createTestQueryClient(), "/checkout", session),
    });

    act(() => {
      result.current.mutate(input);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toMatchObject({
      code: "ADDRESS_LIMIT_REACHED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
