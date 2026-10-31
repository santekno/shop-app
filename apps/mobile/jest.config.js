// Jest settings for the mobile app (`pnpm test:unit`). Test files sit next
// to the code they test (*.test.ts, *.test.tsx), except the screens': Expo
// Router makes every file in app/ a route, a test file too, so the tests of
// app/ live in __tests__/app/ with the same paths (Jest's default
// testMatch finds both).
//
// jest-expo is the SDK-matched preset (58.x for Expo SDK 58): it runs the
// app's own babel.config.js, so NativeWind's JSX runtime and the
// `@/…` paths of tsconfig.json work as they do in Metro, and it mocks the
// native modules (expo-network, expo-font, react-native-svg's views) that
// have no native side under Node. Its default platform is iOS; a test that
// needs Android says so itself (src/config/env.test.ts).
//
// Coverage is off for a plain `jest` run and on for `make test-unit`, which
// passes --coverage.
module.exports = {
  preset: "jest-expo",
  // Runs before each test file's imports: the fake network
  // (src/test/fake-api.ts) must be the global fetch before src/lib/api.ts
  // creates the client, which keeps the fetch it finds at that moment.
  //
  // FlashList's own Jest setup gives its cells a size (Jest has no native
  // layout), so a FlashList renders its rows instead of nothing.
  setupFiles: [
    "<rootDir>/src/test/install-fetch.ts",
    "@shopify/flash-list/jestSetup",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // `make test-unit` runs this package next to the web apps' Vitest
  // (pnpm -r), and the first test of each __tests__/app file loads the
  // whole app (Expo Router, React Navigation, every screen). Under that
  // load the first test of a file ran past Jest's default 5 s, and a test
  // cut off half way leaves its renders running into the next one.
  testTimeout: 30_000,
  // global.css is Tailwind for NativeWind's Metro plugin, not JavaScript.
  moduleNameMapper: { "\\.css$": "<rootDir>/src/test/css-stub.js" },
  // jest-expo's list of packages that ship untranspiled code (and so must
  // go through Babel), plus FlashList, whose dist is ES modules. In a pnpm
  // workspace a package's path ends in node_modules/<name>, after
  // node_modules/.pnpm/<name@version>/, so the last node_modules/ decides.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|@shopify/flash-list))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
  // Every source file counts, including one no test imports yet.
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "src/**/*.{ts,tsx,js}",
    "app.config.ts",
    "!**/*.test.{ts,tsx}",
    // Test helpers and ambient type declarations: no app code to cover.
    "!src/test/**",
    "!**/*.d.ts",
  ],
  // A table in the terminal only, as in packages/shared and the web apps.
  coverageReporters: [["text", { skipFull: false }]],
  // The gate is 70% for TypeScript. A glob key makes Jest check every
  // matching file on its own, so a well-tested file cannot hide an
  // untested one (the web apps' perFile: true).
  coverageThreshold: Object.fromEntries(
    ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx,js}", "./app.config.ts"].map(
      (glob) => [
        glob,
        { lines: 70, branches: 70, functions: 70, statements: 70 },
      ],
    ),
  ),
};
