// A second storefront container next to the stack's: the same image,
// started again with other run-time settings (GA_MEASUREMENT_ID,
// IMAGE_ORIGIN, SITE_URL… are read when the server starts, artikel 14),
// on the stack's network so API_INTERNAL_URL reaches the api container.
import { expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { WEB_URL, compose, docker, waitForOk } from "./stack.ts";

/** The web container's image and Compose network, for docker run. */
export const stackWeb = (): { image: string; network: string } => {
  const id = compose("ps", "-q", "web").trim();
  const [image = "", network = ""] = docker(
    "inspect",
    "-f",
    "{{.Config.Image}} {{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}",
    id,
  )
    .trim()
    .split(" ");
  return { image, network };
};

/** The host port docker published for a container's port. */
export const publishedPort = (container: string, port: number): string => {
  const published = /:(\d+)\s*$/m.exec(docker("port", container, String(port)));
  expect(published, "the container's published port").toBeTruthy();
  return published?.[1] ?? "";
};

/** A running second storefront. */
export interface WebInstance {
  /** Where this machine reaches it, e.g. http://127.0.0.1:49153. */
  base: string;
  /** Removes the container. */
  stop: () => void;
}

/**
 * Starts the stack's web image again with env added to what Compose
 * gives it (PORT, API_INTERNAL_URL), on a free host port, and waits for
 * its /healthz.
 */
export const startWebInstance = async (
  env: Record<string, string>,
): Promise<WebInstance> => {
  const { image, network } = stackWeb();
  const container = docker(
    "run",
    "-d",
    "--network",
    network,
    "-p",
    "127.0.0.1::8080",
    "-e",
    "PORT=8080",
    "-e",
    "API_INTERNAL_URL=http://api:8080",
    ...Object.entries(env).flatMap(([name, value]) => [
      "-e",
      `${name}=${value}`,
    ]),
    image,
  ).trim();
  const stop = () => {
    docker("rm", "-f", container);
  };
  try {
    const base = `http://127.0.0.1:${publishedPort(container, 8080)}`;
    await waitForOk(`${base}/healthz`, 30_000);
    return { base, stop };
  } catch (error) {
    stop();
    throw error;
  }
};

/**
 * Makes the browser get the storefront (WEB_URL) from instance instead:
 * each request to WEB_URL is sent to the instance, and its answer comes
 * back as WEB_URL's. The page keeps WEB_URL's origin, the one the API's
 * CORS allows and the image was built for, so the session, the cart and
 * the CSP work as they do on the stack's own storefront.
 */
export const serveFrom = async (
  context: BrowserContext,
  instance: WebInstance,
): Promise<void> => {
  await context.route(`${WEB_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${instance.base}${url.pathname}${url.search}`,
      maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
};
