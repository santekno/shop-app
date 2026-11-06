// Lets a stub in src/test/mocks/ say how it is reset between tests without
// jest.setup.ts importing it: importing a stub from the setup file loads
// React and its dependencies before the test file does, and
// src/lib/query-client.test.ts (jest.isolateModules) then sees another
// copy of react-native's AppState. The stub registers its reset when it is
// first used; resetMocks runs the ones that are loaded.
const resets: (() => void)[] = [];

/** Called by a stub when it loads: `reset` runs after every test. */
export const onReset = (reset: () => void): void => {
  resets.push(reset);
};

/** After every test (jest.setup.ts). */
export const resetMocks = (): void => {
  for (const reset of resets) reset();
};
