import { describe, expect, it, jest } from "@jest/globals";
import { MutationObserver } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { createTestQueryClient } from "@/test/render";
import { toggleMutationOptions } from "./toggle-options";

const IDS = queryKeys.wishlist.ids();

const gate = () => {
  let release!: () => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
};

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setup = (saved: readonly string[] | null = ["a", "b"]) => {
  const client = createTestQueryClient();
  if (saved !== null) client.setQueryData(IDS, saved);
  const add = jest.fn<(slug: string) => Promise<void>>(() => Promise.resolve());
  const remove = jest.fn<(slug: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const onFailure = jest.fn();
  const onApplied = jest.fn();
  const options = toggleMutationOptions(client, {
    add,
    remove,
    onFailure,
    onApplied,
  });
  const tap = (slug: string, wasSaved: boolean) => {
    const observer = new MutationObserver(client, options);
    return observer.mutate({ slug, saved: !wasSaved });
  };
  return { client, add, remove, onFailure, onApplied, tap };
};

describe("the optimistic wishlist toggle", () => {
  it("fills the heart in the cache before the server answers", async () => {
    const { client, add, tap } = setup();
    const server = gate();
    add.mockReturnValue(server.promise);

    const done = tap("c", false);
    await settle();

    expect(client.getQueryData(IDS)).toEqual(["c", "a", "b"]);
    server.release();
    await done;
  });

  it("saving calls add, removing calls remove, each with the slug", async () => {
    const { add, remove, tap } = setup();

    await tap("c", false);
    await tap("a", true);

    expect(add).toHaveBeenCalledWith("c");
    expect(remove).toHaveBeenCalledWith("a");
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("tells the screen reader what was done, before the server answers", async () => {
    const { add, onApplied, tap } = setup();
    const server = gate();
    add.mockReturnValue(server.promise);

    const done = tap("c", false);
    await settle();

    expect(onApplied).toHaveBeenCalledWith({ slug: "c", saved: true });
    server.release();
    await done;
  });

  it("cancels a saved-slugs fetch that is still in flight", async () => {
    const { client, tap } = setup();
    const cancel = jest.spyOn(client, "cancelQueries");

    await tap("c", false);

    expect(cancel).toHaveBeenCalledWith({ queryKey: IDS });
  });

  it("on failure puts the list back as it was and reports the error", async () => {
    const { client, add, onFailure, tap } = setup();
    const boom = new Error("409");
    add.mockRejectedValue(boom);

    await expect(tap("c", false)).rejects.toBe(boom);

    expect(client.getQueryData(IDS)).toEqual(["a", "b"]);
    expect(onFailure).toHaveBeenCalledWith(boom);
  });

  it("a failed removal brings the heart back", async () => {
    const { client, remove, tap } = setup();
    remove.mockRejectedValue(new Error("x"));

    await expect(tap("a", true)).rejects.toThrow("x");

    expect(client.getQueryData(IDS)).toEqual(["a", "b"]);
  });

  // Finding: the rollback writes `undefined`, and TanStack Query ignores
  // setQueryData(key, undefined), so the optimistic slug stays in the cache
  // until the refetch from onSettled replaces it. Pinned as it is today.
  it("when the list had not loaded, a failure cannot clear the guess; the refetch is what corrects it", async () => {
    const { client, add, tap } = setup(null);
    add.mockRejectedValue(new Error("x"));
    const invalidate = jest.spyOn(client, "invalidateQueries");

    await expect(tap("c", false)).rejects.toThrow();

    expect(client.getQueryData(IDS)).toEqual(["c"]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.wishlist.all,
    });
  });

  it("a failure while a later tap is pending undoes only its own product", async () => {
    const { client, add, tap } = setup(["a"]);
    const first = gate();
    const second = gate();
    add.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const one = tap("b", false);
    const two = tap("c", false);
    await settle();
    expect(client.getQueryData(IDS)).toEqual(["c", "b", "a"]);

    first.fail(new Error("limit"));
    await expect(one).rejects.toThrow("limit");

    expect(client.getQueryData(IDS)).toEqual(["c", "a"]);
    second.release();
    await two;
  });

  it("refetches the saved slugs after a success", async () => {
    const { client, tap } = setup();
    const invalidate = jest.spyOn(client, "invalidateQueries");

    await tap("c", false);

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.wishlist.all,
    });
  });

  it("refetches after a failure too, so the hearts show what the server holds", async () => {
    const { client, add, tap } = setup();
    add.mockRejectedValue(new Error("x"));
    const invalidate = jest.spyOn(client, "invalidateQueries");

    await expect(tap("c", false)).rejects.toThrow();

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("with two taps pending, only the last to settle refetches", async () => {
    const { client, add, tap } = setup();
    const first = gate();
    const second = gate();
    add.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const invalidate = jest.spyOn(client, "invalidateQueries");

    const one = tap("c", false);
    const two = tap("d", false);
    await settle();

    first.release();
    await one;
    expect(invalidate).not.toHaveBeenCalled();

    second.release();
    await two;
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("runs taps one after the other, in the order tapped", async () => {
    const { add, remove, tap } = setup(["a"]);
    const first = gate();
    add.mockReturnValueOnce(first.promise);

    const one = tap("b", false);
    const two = tap("b", true);
    await settle();

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    first.release();
    await Promise.all([one, two]);
    expect(remove).toHaveBeenCalledWith("b");
  });
});
