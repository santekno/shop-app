// React Native Testing Library's matchers (toBeOnTheScreen, toHaveProp …)
// for the `expect` the tests import from @jest/globals. RNTL declares them
// on '@jest/expect', which it cannot resolve from its own folder in a pnpm
// install, so TypeScript drops that declaration. @jest/expect re-exports
// its Matchers from the `expect` package (a devDependency for this file),
// and adding to them there reaches the same interface.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars --
   an interface merge: no members of its own, and it must repeat the
   interface's type parameters exactly, T too. */
import type { JestNativeMatchers } from "@testing-library/react-native/dist/matchers/types";

declare module "expect" {
  interface Matchers<
    R extends void | Promise<void>,
    T = unknown,
  > extends JestNativeMatchers<R> {}
}
