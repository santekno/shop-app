import { describe, expect, inject, it } from "vitest";
import { SERVER_ERROR_CODES } from "./errors.ts";

// vitest.config.js reads these files and hands them over with `provide`;
// this declaration tells TypeScript what `inject` returns.
declare module "vitest" {
  export interface ProvidedContext {
    openapiContract: string;
    envExample: string;
  }
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** The first capture group of every match of `pattern` (which needs the g flag). */
const captures = (text: string, pattern: RegExp): string[] =>
  Array.from(text.matchAll(pattern)).flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

/**
 * The error codes api/openapi.yaml documents. The contract has no enum for
 * them (the Error schema only fixes the SCREAMING_SNAKE_CASE pattern), so
 * they are collected from the two places it names them:
 *
 * - the `code` of every example error body, the line under `error:`;
 * - a name in backticks in a description, such as 409 `CART_CHANGED`,
 *   except a setting from .env.example (`APP_PAYMENT_TTL`) or an HTTP
 *   method (`PUT`), which the descriptions also write in backticks.
 */
const documentedCodes = (contract: string, envExample: string): string[] => {
  const settings = new Set(captures(envExample, /^#?\s*([A-Z][A-Z0-9_]*)=/gm));
  const examples = captures(
    contract,
    /^\s*error:\n\s*code: ([A-Z][A-Z0-9_]*)\s*$/gm,
  );
  const mentioned = captures(contract, /`([A-Z][A-Z0-9_]*)`/g).filter(
    (name) => !settings.has(name) && !HTTP_METHODS.has(name),
  );
  return [...new Set([...examples, ...mentioned])].sort();
};

describe("SERVER_ERROR_CODES", () => {
  const contract = documentedCodes(
    inject("openapiContract"),
    inject("envExample"),
  );
  const listed: readonly string[] = SERVER_ERROR_CODES;

  it("lists every code the contract documents", () => {
    const missing = contract.filter((code) => !listed.includes(code));
    expect(missing, "documented in api/openapi.yaml, missing here").toEqual([]);
  });

  it("lists only codes the contract documents", () => {
    const unknown = listed.filter((code) => !contract.includes(code));
    expect(unknown, "listed here, not in api/openapi.yaml").toEqual([]);
  });

  it("lists each code once", () => {
    expect(new Set(listed).size).toBe(listed.length);
  });
});
