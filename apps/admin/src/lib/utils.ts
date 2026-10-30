import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names, dropping falsy ones (clsx), then lets a later
 * Tailwind class win over an earlier one for the same property
 * (tailwind-merge): cn("px-4", "px-2") is "px-2". That is what lets a
 * caller pass className to a component and override its defaults.
 * shadcn/ui's components all use it.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
