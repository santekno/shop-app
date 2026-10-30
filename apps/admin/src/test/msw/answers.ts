// Answers a handler can give, shared by every feature's handlers.
import { HttpResponse } from "msw";

/** One answer of a handler: a Response, or a promise of one. */
export type Answer = (request: Request) => Response | Promise<Response>;

/** 204 No Content. */
export const noContent = () => new HttpResponse(null, { status: 204 });

/** A network failure: fetch rejects with a TypeError. */
export const networkError = () => HttpResponse.error();

/**
 * A resolver that answers its requests with `answers` in order, one each.
 * A request after the last answer throws, which MSW turns into a 500 and
 * the test into a failure it can read.
 */
export const inOrder = (name: string, answers: readonly Answer[]) => {
  let used = 0;
  return ({ request }: { request: Request }) => {
    const next = answers[used];
    used += 1;
    if (next === undefined) {
      throw new Error(
        `no answer queued for request ${String(used)} to ${name}`,
      );
    }
    return next(request);
  };
};

export { deferred } from "../deferred.ts";
