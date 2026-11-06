// Runs after Jest is installed in each test file, before its tests.
import { afterEach, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { configure } from "@testing-library/react-native";

import { fakeApi } from "./src/test/fake-api";
import { resetNetworkMock } from "./src/test/expo-network";
import { resetMocks } from "./src/test/mocks/registry";

// findBy and waitFor wait up to 5 s instead of 1 s. They return as soon as
// what they wait for is there, so a passing test is not slower; the margin
// is for a machine busy with the other packages' tests (make test-unit).
// Under renderRouter's fake timers the wait is counted on the fake clock.
configure({ asyncUtilTimeout: 5_000 });

// The connection, controlled by the test (src/test/expo-network.ts).
jest.mock("expo-network", () => jest.requireActual("./src/test/expo-network"));

// The native modules of Bab 14, which have no native side under Node. Each
// is replaced by a stub that keeps what the app's code can observe
// (src/test/mocks/*): importing the real packages fails (Reanimated and
// the bottom sheet start the worklets runtime, which reads a TurboModule
// that is not there).
//
// - Reanimated: shared values, animated styles, reduced motion, layout
//   animations. Not "react-native-reanimated/mock": it imports the real
//   module first.
// - The bottom sheet: content only while presented, present()/dismiss().
// - expo-image: a host view that keeps its props, and a prefetch spy.
// - AsyncStorage: the package's own in-memory mock (cleared after each test).
// - Gesture Handler: its own Jest setup (the root view and the touchables).
jest.mock("react-native-reanimated", () =>
  jest.requireActual("./src/test/mocks/reanimated"),
);
jest.mock("@gorhom/bottom-sheet", () =>
  jest.requireActual("./src/test/mocks/bottom-sheet"),
);
jest.mock("expo-image", () =>
  jest.requireActual("./src/test/mocks/expo-image"),
);
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
);

// A request no handler answered fails the test that sent it, even when the
// code under test caught the network error and showed a message: that is
// the lesson of Bab 12 (docs/testing-ai-review.md), where three tests
// passed while relying on a request nobody answered.
//
// A request held by a deferred answer the test never released fails it
// as well: the test ended with that request still in flight.
afterEach(() => {
  const missed = fakeApi.unhandled();
  const held = fakeApi.held();
  fakeApi.reset();
  resetNetworkMock();
  resetMocks();
  void AsyncStorage.clear();
  if (missed.length > 0) {
    throw new Error(
      `request(s) no test handler answered: ${missed.join(", ")}`,
    );
  }
  if (held.length > 0) {
    throw new Error(
      `request(s) held by a deferred answer the test never released: ${held.join(", ")}`,
    );
  }
});
