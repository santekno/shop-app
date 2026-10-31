// expo-network for the tests (jest.setup.ts mocks the module with this
// file). jest-expo's own mock answers every call with undefined, which
// would make src/lib/query-client.ts read `isConnected` of undefined. This
// one remembers the listeners, so a test can switch the network off and on
// (`emitNetworkState`), and answers getNetworkStateAsync with a state the
// test picks (`setInitialNetworkState`), connected by default.
import { jest } from "@jest/globals";
import type { NetworkState } from "expo-network";

type Listener = (state: NetworkState) => void;

const listeners = new Set<Listener>();
let initialState: NetworkState = {
  isConnected: true,
  isInternetReachable: true,
};

export const addNetworkStateListener = jest.fn((listener: Listener) => {
  listeners.add(listener);
  return {
    remove: () => {
      listeners.delete(listener);
    },
  };
});

export const getNetworkStateAsync = jest.fn(() =>
  Promise.resolve(initialState),
);

/** What the next getNetworkStateAsync answers. */
export const setInitialNetworkState = (state: NetworkState) => {
  initialState = state;
};

/** A change of connection, as the OS reports it to every listener. */
export const emitNetworkState = (state: NetworkState) => {
  for (const listener of listeners) listener(state);
};

export const networkListenerCount = () => listeners.size;

export const resetNetworkMock = () => {
  initialState = { isConnected: true, isInternetReachable: true };
};
