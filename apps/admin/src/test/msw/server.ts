// The network of every unit test: MSW's request interception in Node.
// vitest.setup.ts starts it before the first test, removes the handlers a
// test added after each one, and refuses any request no handler answers
// (onUnhandledFrame: "error", MSW 3's name for onUnhandledRequest), so a
// test can never reach a real API.
//
//   server.use(orderDetailHandler(order()));   // this test's answers
//
// Handlers per feature live next to this file (auth.ts, orders.ts,
// reports.ts, events.ts). Each is typed with the response body types
// generated from api/openapi.yaml (@goshop/shared), so a contract change
// that renames or retypes a field breaks the handlers at compile time.
import { setupServer } from "msw/node";

export const server = setupServer();
