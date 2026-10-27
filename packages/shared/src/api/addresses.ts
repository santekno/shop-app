import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  Address,
  AddressCreate,
  AddressDetail,
  AddressList,
} from "./types.ts";

/**
 * GET /v1/me/addresses: every address of the logged-in user, the default
 * first, then the newest. At most 20, so there is no pagination. Needs a
 * client that sends the access token.
 */
export const listAddresses = async (
  api: ApiClient,
  { signal }: EndpointOptions = {},
): Promise<Address[]> => {
  const body = await api.request<AddressList>("/v1/me/addresses", { signal });
  return body.data;
};

/**
 * POST /v1/me/addresses: adds an address. The first one is the default
 * whatever `is_default` says; a later one with `is_default: true` takes
 * the default over. Throws VALIDATION_FAILED (one entry per field) or
 * ADDRESS_LIMIT_REACHED (20 already). Never retried: a POST sent twice
 * would add the address twice.
 */
export const createAddress = async (
  api: ApiClient,
  address: AddressCreate,
  { signal }: EndpointOptions = {},
): Promise<Address> => {
  const body = await api.request<AddressDetail>("/v1/me/addresses", {
    method: "POST",
    body: address,
    signal,
  });
  return body.data;
};
