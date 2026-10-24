import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { CartTokenProvider } from "@/features/cart/CartTokenProvider.tsx";
import { queryClient } from "@/lib/query-client.ts";
import { routes } from "./routes.tsx";

// Created once, when the module loads, never inside a component: a new
// router on every render would throw away the history and the state of
// every page. createBrowserRouter is the "data router": it reads the real
// address bar and the history API, and it unlocks the data APIs (lazy
// routes, errorElement, useNavigation) that later articles use. (Bab 8 had
// one page, chosen by a `selectedSlug` state; the URL now plays that role.)
const router = createBrowserRouter(routes);

export function App() {
  // The provider puts the QueryClient in React context, so every page
  // (inside the router) reads and fills the same cache. The guest cart's
  // token is app-wide state too: the header and the pages share it.
  return (
    <QueryClientProvider client={queryClient}>
      <CartTokenProvider>
        <RouterProvider router={router} />
      </CartTokenProvider>
      {/* A panel to inspect the cache (the flower button, bottom corner).
          The package renders nothing in a production build, and Vite
          drops its code from the bundle. */}
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
