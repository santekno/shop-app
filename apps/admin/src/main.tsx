import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App.tsx";
import "@/index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error('index.html has no element with id="root"');
}

// onCaughtError: every error boundary of this app is a route's
// ErrorBoundary, and RouterProvider's onError (app/App.tsx) already
// reports each of those errors. Reporting here too would report twice.
createRoot(root, {
  onCaughtError: () => {
    // Reported by RouterProvider's onError; see above.
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
