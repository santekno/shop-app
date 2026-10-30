// The staff order endpoints (Bab 12 artikel 06): the queue, one order, and
// its four status changes.
import { http, HttpResponse } from "msw";
import type {
  ErrorBody,
  Order,
  OrderDetail,
  OrderList,
  OrderSummary,
  ShipRequest,
} from "@goshop/shared";
import type { Answer } from "./answers.ts";
import { apiUrl, errorResponse } from "./http.ts";

/** One page of the queue: its orders and the cursor of the next page. */
export const orderListResponse = (
  orders: OrderSummary[],
  nextCursor: string | null = null,
) =>
  HttpResponse.json<OrderList>({
    data: orders,
    page: { next_cursor: nextCursor },
  });

/** The answer of GET /v1/admin/orders/{id} and of every status change. */
export const orderResponse = (value: Order) =>
  HttpResponse.json<OrderDetail>({ data: value });

/**
 * GET /v1/admin/orders: `answer` decides per request (it can read
 * `status` and `cursor` from the URL); an `OrderList` is the same page for
 * every request.
 */
export const orderQueueHandler = (answer: Answer | OrderList) =>
  http.get<never, never, OrderList | ErrorBody>(
    apiUrl("/v1/admin/orders"),
    ({ request }) =>
      typeof answer === "function"
        ? answer(request)
        : HttpResponse.json<OrderList>(answer),
  );

/** GET /v1/admin/orders/{id}: this order for its own ID, 404 for any other. */
export const orderDetailHandler = (answer: Answer | Order) =>
  http.get<{ id: string }, never, OrderDetail | ErrorBody>(
    apiUrl("/v1/admin/orders/{id}"),
    ({ request, params }) => {
      if (typeof answer === "function") return answer(request);
      return params.id === answer.id
        ? orderResponse(answer)
        : errorResponse(404, "NOT_FOUND");
    },
  );

type Action = "process" | "ship" | "complete" | "cancel";

/** POST /v1/admin/orders/{id}/<action>. */
export const orderActionHandler = (action: Action, answer: Answer) =>
  http.post<{ id: string }, ShipRequest | undefined, OrderDetail | ErrorBody>(
    apiUrl(`/v1/admin/orders/{id}/${action}`),
    ({ request }) => answer(request),
  );
