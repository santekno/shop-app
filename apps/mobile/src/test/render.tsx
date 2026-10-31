// Rendering a component the way the app's screens get it: inside a
// TanStack Query cache and the navigation theme (app/_layout.tsx).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react-native";
import { ThemeProvider } from "expo-router";
import type { ReactElement, ReactNode } from "react";

import { navigationTheme } from "@/theme/navigation";

/**
 * A fresh cache per test, with the app's defaults (src/lib/query-client.ts:
 * no TanStack retries, 30 s fresh). gcTime Infinity: no garbage-collection
 * timer outlives the test.
 */
export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity },
    },
  });

const providers =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider value={navigationTheme("light")}>{children}</ThemeProvider>
    </QueryClientProvider>
  );

/** render() inside a query cache (`client`, fresh by default) and the theme. */
export const renderWithProviders = async (
  ui: ReactElement,
  client: QueryClient = createTestQueryClient(),
) => {
  const result = await render(ui, { wrapper: providers(client) });
  return { ...result, client };
};

/** renderHook() inside the same providers. */
export const renderHookWithProviders = async <Result, Props>(
  hook: (props: Props) => Result,
  client: QueryClient = createTestQueryClient(),
) => {
  const result = await renderHook(hook, { wrapper: providers(client) });
  return { ...result, client };
};
