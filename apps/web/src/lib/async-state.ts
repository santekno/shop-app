/**
 * The state of data that is loading: a discriminated union. `status` tells
 * which variant it is, and only the "success" variant has `data`, so the
 * compiler stops code from reading data that is not there yet.
 */
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: unknown };
