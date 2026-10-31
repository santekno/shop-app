// Expo's ambient types: process.env.EXPO_PUBLIC_* as strings, image and font
// imports as modules. `expo start` writes the same reference into
// expo-env.d.ts (gitignored); this committed copy lets `pnpm typecheck` pass
// on a fresh clone that never ran it.
/// <reference types="expo/types" />
