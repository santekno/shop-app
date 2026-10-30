import type { User } from "@goshop/shared";

/** Every role the API knows (`User.role` in the contract). */
export type Role = User["role"];

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
