// Zod, configured once for every schema in @goshop/shared. Schemas import
// `z` from here, never from "zod" directly, so the setting below has run
// before any schema is built or used.
import { z } from "zod";

// jitless: Zod normally checks whether it may compile a fast parser with
// `new Function`. The storefront's Content-Security-Policy forbids eval
// (script-src 'self', apps/web/Caddyfile), so that probe fails; Zod
// catches the error, but Chrome still reports a securitypolicyviolation
// (blockedURI "eval") on every page that loads a schema. Zod's own source
// says so where it skips the probe (zod/v4/core/util.js, allowsEval).
// Without the compiled parser Zod interprets the schema instead, which is
// plenty fast for forms of a few fields.
//
// The call changes Zod's global settings: a side effect. package.json lists
// this file under "sideEffects" (every other file has none), or the bundler,
// seeing that the file's only export is a re-export of "zod", would skip
// the file and the call with it.
z.config({ jitless: true });

export { z };
