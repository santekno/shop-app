import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { routes } from "./routes.tsx";

// Created once, when the module loads, never inside a component: a new
// router on every render would throw away the history and the state of
// every page. createBrowserRouter is the "data router": it reads the real
// address bar and the history API, and it unlocks the data APIs (lazy
// routes, errorElement, useNavigation) that later articles use. (Bab 8 had
// one page, chosen by a `selectedSlug` state; the URL now plays that role.)
const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
