import { clsx, type ClassValue } from "clsx";
import type { Snippet } from "svelte";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// Types expected by shadcn-svelte generated components
export type WithElementRef<T, El extends HTMLElement = HTMLElement> = T & {
  ref?: El | null;
};

export type WithoutChildrenOrChild<T> = Omit<T, "children" | "child">;

export type WithoutChild<T> = Omit<T, "child">;

export type WithChildren<T = {}> = T & { children?: Snippet };
