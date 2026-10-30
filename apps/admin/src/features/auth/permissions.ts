import type { Role } from "./roles.ts";

/**
 * Who may do what in the dashboard (artikel 08): every action the UI asks
 * about, with the roles the API lets through for it. The one place the
 * dashboard decides by role; a component asks `can(role, action)`, never
 * `role === "admin"`.
 *
 * It mirrors the API's route groups (apps/api/internal/app/app.go), and
 * the API is the rule: a role that is missing here only hides a button,
 * a role that is wrong here only shows one the API refuses with 403.
 * When the API changes a group, change this table in the same commit.
 *
 *   /v1/admin/**                       seller, admin   RequireRole(seller, admin)
 *   POST /v1/admin/orders/{id}/cancel  admin           RequireRole(admin), Bab 12
 *
 * A buyer is in no list: the API answers 403 to every /v1/admin request
 * of theirs, and RequireStaff shows them the "no access" page.
 */
const PERMISSIONS = {
  /**
   * Open the dashboard: the product table and forms, photos, stock, the
   * order queue and detail, the sales report. Every GET and write under
   * /v1/admin except the one below.
   */
  "dashboard:view": ["seller", "admin"],
  /** Move an order on: process, ship (with the resi), complete. */
  "order:fulfil": ["seller", "admin"],
  /**
   * Cancel an order. Admin only since Bab 12: cancellations and refunds
   * belong to the store's admins (docs/prd.md).
   */
  "order:cancel": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

/** Every action the dashboard checks: `can(role, "order:cancel")`. */
export type Permission = keyof typeof PERMISSIONS;

/**
 * Whether `role` may do `action`, as far as the UI knows. It decides what
 * is shown (a button, a page, a sentence that says who can); the API
 * decides what happens, and its 403 wins over this every time.
 */
export const can = (role: Role, action: Permission): boolean =>
  (PERMISSIONS[action] as readonly Role[]).includes(role);
