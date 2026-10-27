import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App.tsx";
import "@/index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error('index.html has no element with id="root"');
}

// onCaughtError: what React does with an error an error boundary caught.
// The default logs it, but every error boundary in this app is a route's
// ErrorBoundary, and React Router already hands each of those errors to
// RouterProvider's onError (app/App.tsx), which reports it. Reporting here
// as well would report every error twice, so this does nothing. A boundary
// of our own outside the routes would need its own reporting.
createRoot(root, {
  onCaughtError: () => {
    // Reported by RouterProvider's onError; see above.
  },
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
