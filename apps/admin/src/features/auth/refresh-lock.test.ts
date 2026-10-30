import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@/test/deferred.ts";
import { SESSION_LOCK_NAME, withSessionLock } from "./refresh-lock.ts";

/**
 * A stand-in for navigator.locks: one holder per name at a time, in
 * order, like the browser's (which jsdom does not have).
 */
const installWebLocks = () => {
  const tails = new Map<string, Promise<unknown>>();
  const request = vi.fn(
    (name: string, task: () => Promise<unknown>): Promise<unknown> => {
      const run = (tails.get(name) ?? Promise.resolve()).then(task, task);
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return request;
};

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
});

/** Records when each task starts and ends, to see whether two overlap. */
const recorder = () => {
  const events: string[] = [];
  const task =
    (name: string, gate: Promise<unknown>, fail = false) =>
    async () => {
      events.push(`start ${name}`);
      await gate;
      events.push(`end ${name}`);
      if (fail) throw new Error(`${name} failed`);
      return name;
    };
  return { events, task };
};

describe("withSessionLock with the Web Locks API", () => {
  it("runs the task under the goshop:session lock and returns its value", async () => {
    const request = installWebLocks();

    await expect(withSessionLock(() => Promise.resolve(42))).resolves.toBe(42);

    expect(SESSION_LOCK_NAME).toBe("goshop:session");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("goshop:session");
  });

  it("rejects with the task's own error", async () => {
    installWebLocks();
    const boom = new Error("boom");

    await expect(withSessionLock(() => Promise.reject(boom))).rejects.toBe(
      boom,
    );
  });

  it("starts the second task only after the first has finished", async () => {
    installWebLocks();
    const { events, task } = recorder();
    const first = deferred<undefined>();

    const a = withSessionLock(task("a", first.promise));
    const b = withSessionLock(task("b", Promise.resolve()));
    await Promise.resolve();
    expect(events).toEqual(["start a"]);

    first.resolve(undefined);
    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
    expect(events).toEqual(["start a", "end a", "start b", "end b"]);
  });
});

describe("withSessionLock without the Web Locks API (fallback queue)", () => {
  it("has no navigator.locks in this environment", () => {
    expect("locks" in navigator).toBe(false);
  });

  it("runs this tab's tasks one at a time, in order", async () => {
    const { events, task } = recorder();
    const first = deferred<undefined>();
    const second = deferred<undefined>();

    const a = withSessionLock(task("a", first.promise));
    const b = withSessionLock(task("b", second.promise));
    const c = withSessionLock(task("c", Promise.resolve()));
    await vi.waitFor(() => {
      expect(events).toEqual(["start a"]);
    });

    first.resolve(undefined);
    await vi.waitFor(() => {
      expect(events).toEqual(["start a", "end a", "start b"]);
    });
    second.resolve(undefined);

    await expect(Promise.all([a, b, c])).resolves.toEqual(["a", "b", "c"]);
    expect(events).toEqual([
      "start a",
      "end a",
      "start b",
      "end b",
      "start c",
      "end c",
    ]);
  });

  it("keeps the order after a failure, and reports it to its own caller only", async () => {
    const { events, task } = recorder();
    const first = deferred<undefined>();

    const a = withSessionLock(task("a", first.promise, true));
    const b = withSessionLock(task("b", Promise.resolve()));
    first.resolve(undefined);

    await expect(a).rejects.toThrow("a failed");
    await expect(b).resolves.toBe("b");
    expect(events).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("keeps working after a task that threw synchronously", async () => {
    const a = withSessionLock(() => {
      throw new Error("sync");
    });

    await expect(a).rejects.toThrow("sync");
    await expect(withSessionLock(() => Promise.resolve("next"))).resolves.toBe(
      "next",
    );
  });
});
