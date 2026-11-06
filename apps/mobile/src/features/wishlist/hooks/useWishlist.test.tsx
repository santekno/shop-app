import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { dismissNotice, useNotice } from "@/lib/notice";
import { apiError, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { renderHookWithProviders } from "@/test/render";
import { getAccessToken } from "../auth-seam";
import {
  isSignedIn,
  useIsWishlisted,
  useToggleWishlist,
  wishlistIdsQuery,
  wishlistListQuery,
} from "./useWishlist";

jest.mock("../auth-seam", () => ({ getAccessToken: jest.fn(() => null) }));

const signIn = (token: string | null) => {
  jest.mocked(getAccessToken).mockReturnValue(token);
};

const savedSlugs = (...names: string[]) => {
  fakeApi.on("GET", "/v1/me/wishlist", () =>
    json(productPage(names.map((n) => product(n)))),
  );
};

const useBoth = (slug: string, saved: boolean) => ({
  toggle: useToggleWishlist(),
  notice: useNotice(),
  saved: useIsWishlisted(slug),
  wasSaved: saved,
});

const announced = () =>
  jest.spyOn(AccessibilityInfo, "announceForAccessibility");

beforeEach(() => {
  announced().mockClear();
});

afterEach(() => {
  signIn(null);
  dismissNotice();
  jest.restoreAllMocks();
});

describe("isSignedIn", () => {
  it("is true only when the seam hands out a token", () => {
    expect(isSignedIn()).toBe(false);
    signIn("t");
    expect(isSignedIn()).toBe(true);
  });
});

describe("the wishlist queries", () => {
  it("are disabled while signed out, so no request can only answer 401", () => {
    expect(wishlistIdsQuery(false).enabled).toBe(false);
    expect(wishlistListQuery(false).enabled).toBe(false);
  });

  it("the list pages by the cursor the server sent, and ends when there is none", () => {
    const query = wishlistListQuery(true);
    const page = (next: string | null) => productPage([], next);

    expect(query.getNextPageParam(page("c2"), [], null, [])).toBe("c2");
    expect(query.getNextPageParam(page(null), [], null, [])).toBeUndefined();
  });
});

describe("useIsWishlisted", () => {
  it("is false signed out, and asks nobody", async () => {
    const { result } = await renderHookWithProviders(() =>
      useIsWishlisted("kaos"),
    );

    expect(result.current).toBe(false);
    expect(fakeApi.requests()).toHaveLength(0);
  });

  it("is true for a slug the server lists, false for another", async () => {
    signIn("t");
    savedSlugs("Kaos");

    const yes = await renderHookWithProviders(() => useIsWishlisted("kaos"));
    await waitFor(() => {
      expect(yes.result.current).toBe(true);
    });
    const no = await renderHookWithProviders(() => useIsWishlisted("celana"));
    await waitFor(() => {
      expect(fakeApi.requests("GET", "/v1/me/wishlist").length).toBeGreaterThan(
        1,
      );
    });
    expect(no.result.current).toBe(false);
  });
});

describe("useToggleWishlist", () => {
  it("signed out: says to sign in and sends nothing", async () => {
    const { result } = await renderHookWithProviders(() =>
      useBoth("kaos", false),
    );

    await act(() => {
      result.current.toggle("kaos", false);
    });

    expect(result.current.notice?.message).toBe(
      "Masuk dulu untuk menyimpan wishlist",
    );
    expect(fakeApi.requests()).toHaveLength(0);
  });

  it("signed in: saving flips the heart, announces it and PUTs", async () => {
    signIn("t");
    let saved: string[] = [];
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage(saved.map((n) => product(n)))),
    );
    fakeApi.on("PUT", "/v1/me/wishlist/kaos", () => {
      saved = ["Kaos"];
      return new Response(null, { status: 204 });
    });
    const { result } = await renderHookWithProviders(() =>
      useBoth("kaos", false),
    );
    await waitFor(() => {
      expect(fakeApi.requests("GET", "/v1/me/wishlist")).toHaveLength(1);
    });

    await act(() => {
      result.current.toggle("kaos", false);
    });

    await waitFor(() => {
      expect(result.current.saved).toBe(true);
    });
    expect(announced()).toHaveBeenCalledWith("Disimpan ke wishlist");
    await waitFor(() => {
      expect(fakeApi.requests("PUT", "/v1/me/wishlist/kaos")).toHaveLength(1);
    });
  });

  it("signed in: removing DELETEs and announces the removal", async () => {
    signIn("t");
    let saved = ["Kaos"];
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage(saved.map((n) => product(n)))),
    );
    fakeApi.on("DELETE", "/v1/me/wishlist/kaos", () => {
      saved = [];
      return new Response(null, { status: 204 });
    });
    const { result } = await renderHookWithProviders(() =>
      useBoth("kaos", true),
    );
    await waitFor(() => {
      expect(result.current.saved).toBe(true);
    });

    await act(() => {
      result.current.toggle("kaos", true);
    });

    await waitFor(() => {
      expect(result.current.saved).toBe(false);
    });
    expect(announced()).toHaveBeenCalledWith("Dihapus dari wishlist");
    expect(fakeApi.requests("DELETE", "/v1/me/wishlist/kaos")).toHaveLength(1);
  });

  it("a full wishlist (409) puts the heart back and shows the limit", async () => {
    signIn("t");
    fakeApi.on("PUT", "/v1/me/wishlist/kaos", () =>
      apiError(409, "WISHLIST_LIMIT_REACHED"),
    );
    savedSlugs();
    const { result } = await renderHookWithProviders(() =>
      useBoth("kaos", false),
    );
    await waitFor(() => {
      expect(fakeApi.requests("GET", "/v1/me/wishlist")).toHaveLength(1);
    });

    await act(() => {
      result.current.toggle("kaos", false);
    });

    await waitFor(() => {
      expect(result.current.notice?.message).toBe(
        "Wishlist penuh (maksimal 200 produk). Hapus satu produk dulu.",
      );
    });
    await waitFor(() => {
      expect(result.current.saved).toBe(false);
    });
  });
});
