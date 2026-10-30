import { screen, waitFor, within } from "@testing-library/react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { queryClient } from "@/lib/query-client.ts";
import { salesReport, user, webSession } from "@/test/fixtures.ts";
import { noContent } from "@/test/msw/answers.ts";
import {
  sessionResponse,
  webLogoutHandler,
  webRefreshHandler,
} from "@/test/msw/auth.ts";
import { quietEventsHandler } from "@/test/msw/events.ts";
import { salesReportHandler } from "@/test/msw/reports.ts";
import { server } from "@/test/msw/server.ts";
import { App } from "./App.tsx";

// The real App: its browser router (at jsdom's "/"), the app-wide
// QueryClient and a SessionProvider that restores the session from the
// cookie, through MSW. One test per file run: the router and the client
// are module-level, like in the browser.
describe("App", () => {
  it("restores the session, opens the dashboard, and forgets every cached query after a logout", async () => {
    server.use(
      webRefreshHandler(() =>
        sessionResponse(webSession("restored", user({ name: "Sari" }))),
      ),
      webLogoutHandler(() => noContent()),
      quietEventsHandler(),
      salesReportHandler(salesReport()),
    );
    const userEvents = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Ringkasan" }),
    ).toBeInTheDocument();
    await screen.findByText("Langsung");
    queryClient.setQueryData(["admin", "orders", "detail", "o-1"], {
      secret: true,
    });

    await userEvents.click(
      within(screen.getByRole("banner")).getByRole("button", { name: /Sari/ }),
    );
    await userEvents.click(
      await screen.findByRole("menuitem", { name: "Keluar" }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Masuk" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(queryClient.getQueryCache().getAll()).toEqual([]);
    });
    expect(window.location.pathname).toBe("/masuk");
  });
});
