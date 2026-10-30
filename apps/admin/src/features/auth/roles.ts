import type { User } from "@goshop/shared";

/** Every role the API knows (`User.role` in the contract). */
export type Role = User["role"];

/** The roles that may use the dashboard: everyone but a buyer. */
export type StaffRole = Exclude<Role, "buyer">;

/**
 * Whether `role` may use the dashboard at all. The API decides the same
 * thing for every /v1/admin request (403 FORBIDDEN for a buyer), so this
 * is about what the user sees, not about security: a buyer gets a clear
 * "no access" page instead of a dashboard full of 403 errors.
 *
 * What each staff role may do inside the dashboard (a seller may not
 * cancel an order, for example) comes in artikel 08.
 */
export const isStaffRole = (role: Role): role is StaffRole =>
  role === "seller" || role === "admin";

/** The role's name as the dashboard shows it. */
export const roleLabel = (role: Role): string => {
  switch (role) {
    case "admin":
      return "Admin";
    case "seller":
      return "Penjual";
    case "buyer":
      return "Pembeli";
  }
};
