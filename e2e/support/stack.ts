// Where the Compose stack is, and how the tests drive it. The defaults are
// what docker-compose.yml publishes. The specs expect the example catalog,
// so outside make test-integration (which does both) run `make up` and
// `make seed` before `pnpm --filter @goshop/e2e test:e2e`.
import { execFileSync } from "node:child_process";
import path from "node:path";

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

/**
 * The storefront container. localhost, not 127.0.0.1: the page's origin
 * must be exactly http://localhost:5173, the origin the API's CORS default
 * (APP_CORS_ALLOWED_ORIGINS) allows.
 */
export const WEB_URL = trimSlash(
  process.env.GOSHOP_WEB_URL ?? "http://localhost:5173",
);

/**
 * The admin dashboard container (Bab 12). localhost, like WEB_URL: its
 * origin must be exactly the one APP_CORS_ALLOWED_ORIGINS allows
 * (http://localhost:5174 by default).
 */
export const ADMIN_URL = trimSlash(
  process.env.GOSHOP_ADMIN_URL ?? "http://localhost:5174",
);

/** The api container, as the tests reach it from this machine. */
export const API_URL = trimSlash(
  process.env.GOSHOP_API_URL ?? "http://localhost:8080",
);

/**
 * The API as the browser reaches it: the NEXT_PUBLIC_API_URL the web image
 * was built with (docker-compose.yml's default; Bab 7–10's VITE_API_URL),
 * which also ends up in the Content-Security-Policy's connect-src.
 */
export const BROWSER_API_URL = trimSlash(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
);

/**
 * The storefront's public origin the web container runs with (SITE_URL,
 * docker-compose.yml's default): canonical links, Open Graph and the
 * sitemap name it.
 */
export const SITE_URL = trimSlash(
  process.env.SITE_URL ?? "http://localhost:5173",
);

/** The repository root, where docker-compose.yml lives. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The Compose command: GOSHOP_COMPOSE when make passes it ("docker compose"
 * or "docker-compose"), otherwise whichever of the two this machine has.
 */
const composeCommand = (): string[] => {
  const fromEnv = process.env.GOSHOP_COMPOSE?.trim();
  if (fromEnv) return fromEnv.split(/\s+/);
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return ["docker", "compose"];
  } catch {
    return ["docker-compose"];
  }
};

/** Options for composeWith. */
export interface ComposeOptions {
  /** Added to this process's environment, for ${VAR} in docker-compose.yml. */
  env?: Record<string, string>;
  /** Kill the command after this long. Default 120 000. */
  timeoutMs?: number;
}

/** Runs one Compose command in the repository root and returns its stdout. */
export const composeWith = (
  { env = {}, timeoutMs = 120_000 }: ComposeOptions,
  ...args: string[]
): string => {
  const [command = "docker-compose", ...prefix] = composeCommand();
  return execFileSync(command, [...prefix, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
};

/** composeWith with the defaults. */
export const compose = (...args: string[]): string => composeWith({}, ...args);

/**
 * Runs SQL in the stack's Postgres (psql -At: unaligned, no headers) and
 * returns its output, one row per line, columns separated by "|". For
 * what the API has no endpoint for (a verified email, a product's stock
 * put back). Only values the specs make themselves (UUIDs, generated
 * emails, slugs) are written into the statement.
 */
export const psql = (sql: string): string =>
  compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "goshop",
    "-d",
    "goshop",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    sql,
  ).trim();

/**
 * The IMAGE_ORIGIN the running web container was started with: where the
 * browser loads product photos from (docker-compose.yml).
 */
export const stackImageOrigin = (): string =>
  compose("exec", "-T", "web", "printenv", "IMAGE_ORIGIN").trim();

/** Runs one docker CLI command and returns its stdout. */
export const docker = (...args: string[]): string =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });

/** Polls url until it answers 200, or throws after timeoutMs. */
export const waitForOk = async (
  url: string,
  timeoutMs = 60_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer 200 within ${timeoutMs} ms (${last})`);
};

/**
 * The categories make seed writes (category.SeedCategories in the API):
 * each parent with its children, in the API's order (sorted by name).
 */
export const SEEDED_TREE: Readonly<Record<string, readonly string[]>> = {
  Elektronik: ["Aksesoris Ponsel", "Ponsel"],
  "Makanan & Minuman": ["Camilan", "Kopi & Teh"],
  Pakaian: ["Celana", "Kaos", "Kemeja"],
  "Rumah Tangga": ["Dekorasi Rumah", "Peralatan Dapur"],
};

/** One row of GET /v1/categories, as the contract defines it. */
export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
}

/** GET /v1/categories with plain fetch, independent of @goshop/shared. */
export const fetchCategories = async (): Promise<CategoryRow[]> => {
  const response = await fetch(`${API_URL}/v1/categories`);
  if (response.status !== 200) {
    throw new Error(`GET /v1/categories = ${response.status}, want 200`);
  }
  const body = (await response.json()) as { data: CategoryRow[] };
  return body.data;
};

/** A category tree by name only: what the storefront is expected to show. */
export interface NamedNode {
  name: string;
  children: NamedNode[];
}

/**
 * Nests the API's rows the way the contract describes them, keeping the
 * API's order: roots are the rows without a parent, children follow their
 * parent_id. Written here rather than imported from @goshop/shared, so the
 * storefront is checked against the contract, not against its own code.
 */
export const nestByParent = (
  rows: readonly CategoryRow[],
  parentId: string | null = null,
): NamedNode[] =>
  rows
    .filter((row) => row.parent_id === parentId)
    .map((row) => ({ name: row.name, children: nestByParent(rows, row.id) }));
