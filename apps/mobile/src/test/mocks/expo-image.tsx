// expo-image for the tests (jest.setup.ts mocks the module with this file).
// The real component is a native view (SDWebImage / Glide). This one is a
// host view named "ExpoImage" that keeps every prop the app gave it
// (source, contentFit, cachePolicy, transition, recyclingKey, style …)
// readable, and `Image.prefetch` is a jest.fn that resolves true.
import { jest } from "@jest/globals";
import { createElement, forwardRef } from "react";

import { onReset } from "./registry";

export const prefetch = jest.fn<
  (urls: string | string[], cachePolicy?: string) => Promise<boolean>
>(() => Promise.resolve(true));

export const Image = Object.assign(
  forwardRef<unknown, Record<string, unknown>>(function ExpoImage(props, ref) {
    return createElement("ExpoImage", { ...props, ref });
  }),
  { prefetch },
);

onReset(() => {
  prefetch.mockReset();
  prefetch.mockImplementation(() => Promise.resolve(true));
});
