// The device's "reduce motion" setting, for the tests. The Reanimated stub
// (src/test/mocks/reanimated.tsx) answers useReducedMotion with it; it is
// false again before every test (jest.setup.ts).
import * as reanimated from "react-native-reanimated";

export const setReducedMotion = (on: boolean) => {
  (
    reanimated as unknown as {
      useReducedMotion: { mockReturnValue: (value: boolean) => void };
    }
  ).useReducedMotion.mockReturnValue(on);
};
