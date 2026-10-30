// The network of every unit test: MSW's request interception in Node.
// vitest.setup.ts starts it before the first test and removes the handlers
// a test added after each one. A request no handler answers is refused
// (the client sees a network error, so a test can never reach a real API)
// and recorded; vitest.setup.ts then fails the test that sent it, even
// when the code under test swallowed the network error.
//
//   server.use(orderDetailHandler(order()));   // this test's answers
//
// Handlers per feature live next to this file (auth.ts, orders.ts,
// reports.ts, events.ts). Each is typed with the response body types
// generated from api/openapi.yaml (@goshop/shared), so a contract change
// that renames or retypes a field breaks the handlers at compile time.
import { setupServer } from "msw/node";
import type { UnhandledFrameHandle } from "msw";

export const server = setupServer();

type UnhandledFrame = Exclude<UnhandledFrameHandle, string>;

const unhandled: string[] = [];

/**
 * server.listen's onUnhandledFrame: prints MSW's own message, records the
 * request ("GET http://…/v1/…"), and fails the request. (MSW's
 * `defaults.error()` only prints; without the throw the request would go
 * on to the real network.)
 */
export const refuseAndRecordUnhandled: UnhandledFrame = ({
  frame,
  defaults,
}) => {
  const data = frame.data as {
    request?: Request;
    connection?: { client: { url: URL } };
  };
  unhandled.push(
    data.request
      ? `${data.request.method} ${data.request.url}`
      : `WebSocket ${String(data.connection?.client.url)}`,
  );
  defaults.error();
  // MSW answers with a Response the callback throws. Response.error() is
  // a network error, which is what the "error" strategy gives; a thrown
  // Error would become a 500 answer instead.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw Response.error();
};

/** The unhandled requests recorded since the last call, emptying the list. */
export const takeUnhandledRequests = (): string[] => unhandled.splice(0);
