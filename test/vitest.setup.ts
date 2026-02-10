import { vi } from "vitest";

const DIRECT_CALL_WARNING =
  "Convex functions should not directly call other Convex functions.";
const EXPECTED_ERROR_SUBSTRINGS = [
  "Invalid verification code",
  "Too many failed attempts to verify code for this email",
  "Expired refresh token",
  "Refresh token used outside of reuse window",
];

const originalWarn = console.warn;
const originalError = console.error;

vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
  const [firstArg] = args;
  if (typeof firstArg === "string" && firstArg.includes(DIRECT_CALL_WARNING)) {
    return;
  }
  originalWarn(...(args as Parameters<typeof console.warn>));
});

vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const joined = args
    .map((arg) => (typeof arg === "string" ? arg : ""))
    .join(" ");
  if (EXPECTED_ERROR_SUBSTRINGS.some((s) => joined.includes(s))) {
    return;
  }
  originalError(...(args as Parameters<typeof console.error>));
});
