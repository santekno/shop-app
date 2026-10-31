import { describe, expect, it, jest } from "@jest/globals";
import type { NetworkState } from "expo-network";

import type * as NetworkMock from "@/test/expo-network";

type AppStateListener = (state: string) => void;

/**
 * A fresh copy of query-client.ts with its own TanStack managers, the
 * expo-network mock it registered with, and the AppState listener it
 * added. The managers are module singletons: a copy per test keeps one
 * test's offline state out of the next.
 */
const load = (initial?: NetworkState) => {
  let loaded:
    | {
        module: typeof import("./query-client");
        tanstack: typeof import("@tanstack/react-query");
        network: typeof NetworkMock;
        appState: AppStateListener;
      }
    | undefined;
  jest.isolateModules(() => {
    const network = jest.requireMock<typeof NetworkMock>("expo-network");
    if (initial !== undefined) network.setInitialNetworkState(initial);
    const { AppState } =
      jest.requireActual<typeof import("react-native")>("react-native");
    // React Native's Jest preset makes addEventListener a mock; the spy
    // records the listener query-client.ts adds.
    const addListener = jest.spyOn(AppState, "addEventListener");
    const module =
      jest.requireActual<typeof import("./query-client")>("./query-client");
    const tanstack = jest.requireActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
    const call = addListener.mock.calls.find(([type]) => type === "change");
    if (call === undefined) throw new Error("no AppState change listener");
    loaded = {
      module,
      tanstack,
      network,
      appState: call[1] as AppStateListener,
    };
  });
  if (loaded === undefined) throw new Error("query-client did not load");
  return loaded;
};

/** Lets the getNetworkStateAsync promise settle. */
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("queryClient defaults", () => {
  it("does not retry on top of the API client, and keeps data fresh for 30 s", () => {
    const { module } = load();
    const queries = module.queryClient.getDefaultOptions().queries;

    expect(module.DEFAULT_STALE_TIME_MS).toBe(30_000);
    expect(queries?.retry).toBe(false);
    expect(queries?.staleTime).toBe(30_000);
  });
});

describe("focus: the app in front", () => {
  it.each([
    ["active", true],
    ["background", false],
    ["inactive", false],
  ])("AppState %s means focused = %s", (state, focused) => {
    const { tanstack, appState } = load();

    appState(state);

    expect(tanstack.focusManager.isFocused()).toBe(focused);
  });

  it("comes back to focused after the app returns", () => {
    const { tanstack, appState } = load();
    appState("background");
    appState("active");
    expect(tanstack.focusManager.isFocused()).toBe(true);
  });
});

describe("online: the phone's connection", () => {
  it("asks for the connection once at start-up: offline at launch pauses queries", async () => {
    const { tanstack, network } = load({
      isConnected: false,
      isInternetReachable: false,
    });
    await settle();

    expect(network.getNetworkStateAsync).toHaveBeenCalled();
    expect(tanstack.onlineManager.isOnline()).toBe(false);
  });

  it("is online at launch when the phone is connected", async () => {
    const { tanstack } = load({ isConnected: true });
    tanstack.onlineManager.setOnline(false);
    await settle();
    expect(tanstack.onlineManager.isOnline()).toBe(true);
  });

  it.each([
    ["isConnected false", { isConnected: false }, false],
    ["isConnected true", { isConnected: true }, true],
    [
      "connected without validated internet (a LAN API)",
      { isConnected: true, isInternetReachable: false },
      true,
    ],
    ["a state that does not say", {}, true],
  ])("a change to %s sets online = %s", async (_name, state, online) => {
    const { tanstack, network } = load();
    await settle();

    network.emitNetworkState({ isConnected: !online });
    network.emitNetworkState(state);

    expect(tanstack.onlineManager.isOnline()).toBe(online);
  });

  it("an unknown state at launch counts as online", async () => {
    const { tanstack } = load({});
    tanstack.onlineManager.setOnline(false);
    await settle();
    expect(tanstack.onlineManager.isOnline()).toBe(true);
  });

  it("follows the network going away and coming back", async () => {
    const { tanstack, network } = load();
    await settle();

    network.emitNetworkState({ isConnected: false });
    expect(tanstack.onlineManager.isOnline()).toBe(false);
    network.emitNetworkState({ isConnected: true });
    expect(tanstack.onlineManager.isOnline()).toBe(true);
  });

  it("removes its listeners when another one replaces them", () => {
    const { tanstack, network } = load();
    const before = network.networkListenerCount();

    tanstack.onlineManager.setEventListener(() => undefined);

    expect(network.networkListenerCount()).toBe(before - 1);
  });

  it("removes its AppState subscription when replaced", () => {
    const remove = jest.fn();
    jest.isolateModules(() => {
      const { AppState } =
        jest.requireActual<typeof import("react-native")>("react-native");
      jest.spyOn(AppState, "addEventListener").mockReturnValueOnce({ remove });
      jest.requireActual("./query-client");
      const { focusManager } = jest.requireActual<
        typeof import("@tanstack/react-query")
      >("@tanstack/react-query");
      focusManager.setEventListener(() => undefined);
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
