// A Jest setupFile: runs before each test file's own imports, so the client
// that src/lib/api.ts creates on import keeps the fake fetch (the shared
// client reads globalThis.fetch once, when it is created).
import { fakeFetch } from "./fake-api";

globalThis.fetch = fakeFetch;
