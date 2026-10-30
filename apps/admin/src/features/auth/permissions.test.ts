import { describe, expect, it } from "vitest";
import { can } from "./permissions.ts";
import type { Permission } from "./permissions.ts";
import { roleLabel } from "./roles.ts";
import type { Role } from "./roles.ts";

describe("can", () => {
  // The whole table, so a permission granted or taken away by mistake
  // fails here, whichever cell it is.
  it.each<[Role, Permission, boolean]>([
    ["buyer", "dashboard:view", false],
    ["buyer", "order:fulfil", false],
    ["buyer", "order:cancel", false],
    ["seller", "dashboard:view", true],
    ["seller", "order:fulfil", true],
    ["seller", "order:cancel", false],
    ["admin", "dashboard:view", true],
    ["admin", "order:fulfil", true],
    ["admin", "order:cancel", true],
  ])("%s may %s: %s", (role, action, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });
});

describe("roleLabel", () => {
  it.each<[Role, string]>([
    ["admin", "Admin"],
    ["seller", "Penjual"],
    ["buyer", "Pembeli"],
  ])("names %s %s", (role, label) => {
    expect(roleLabel(role)).toBe(label);
  });
});
