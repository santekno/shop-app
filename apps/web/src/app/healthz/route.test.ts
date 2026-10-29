import { describe, expect, it } from "vitest";
import { GET } from "./route.ts";

describe("GET /healthz", () => {
  it("answers 200 ok as plain text, never cached", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("ok");
  });

  it("answers a fresh response each time (a body can be read only once)", async () => {
    const first = GET();
    await first.text();

    await expect(GET().text()).resolves.toBe("ok");
  });
});
