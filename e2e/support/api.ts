// Helpers for the specs that call the real API through @goshop/shared.
import { expect } from "@playwright/test";
import { ApiError, createApiClient } from "@goshop/shared";
import { API_URL } from "./stack.ts";

/** The shared client, pointed at the api container. */
export const api = createApiClient({ baseUrl: API_URL, timeoutMs: 5000 });

/** Runs call and returns the ApiError it throws; fails if it resolves. */
export const apiErrorOf = async (
  call: () => Promise<unknown>,
): Promise<ApiError> => {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("the call resolved, want an ApiError");
};

/** A request ID of our own, so the test can tell its response apart. */
export const newRequestId = (): string => `e2e-${crypto.randomUUID()}`;
