// Small text rules shared by the schemas. Not exported from the package.

/**
 * Characters as the API counts them. Go's validator counts runes (code
 * points); a JavaScript string's `length` counts UTF-16 units, so "🔑" is
 * 2 there. Array.from splits by code point.
 */
export const characters = (value: string): number => Array.from(value).length;

/** Text PostgreSQL can store: the API refuses a NUL character. */
export const hasNoNul = (value: string): boolean => !value.includes("\u0000");
