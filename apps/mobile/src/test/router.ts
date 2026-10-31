// Rendering the real app/ directory with Expo Router's test renderer: the
// root stack, the tabs, every screen, as a deep link opens them.
import path from "node:path";

import { jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

import { fakeApi, json } from "./fake-api";

const APP_DIR = path.resolve(__dirname, "../../app");

/** Opens the app at `url` (a path with its query, as goshop://<url>). */
export const renderApp = (url = "/") =>
  renderRouter(APP_DIR, { initialUrl: url });

/**
 * The titles of the native stack headers on screen, bottom of the stack
 * first. The header is drawn natively, so its title is a prop of the
 * header's native config view, not a Text RNTL can find.
 */
export const headerTitles = (): unknown[] =>
  screen.container
    .queryAll((i) => i.type === "RNSScreenStackHeaderConfig")
    .filter((i) => i.props.hidden !== true)
    .map((i) => i.props.title as unknown);

/**
 * Answers the catalog with an empty list. Any screen opened from a link
 * has the tabs under it (the root stack's anchor), so Beranda mounts and
 * asks for its products even when the test is about another screen.
 */
export const answerEmptyCatalog = () => {
  fakeApi.on("GET", "/v1/products", () =>
    json({ data: [], page: { next_cursor: null } }),
  );
};

/**
 * Lets the screens hear about a change in the query cache. TanStack Query
 * tells components on the next timer tick (notifyManager's setTimeout 0),
 * and renderRouter turns on Jest's fake timers, so that tick only comes
 * when a test moves the clock. Without it, an assertion that something is
 * NOT shown while a request runs passes before the screen even knows.
 */
export const flushQueryNotifications = () =>
  act(() => {
    jest.advanceTimersByTime(0);
  });
