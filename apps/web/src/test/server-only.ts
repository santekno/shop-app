// What "server-only" resolves to under Vitest (vite.config.ts): nothing.
// The real package throws when imported outside a React Server
// Components build; a unit test imports server modules on purpose.
export {};
