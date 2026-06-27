/**
 * Extract a clean, human-readable message from a thrown error. Convex throws
 * `ConvexError` whose `.message` is the full server stack trace, but the
 * intended user-facing text lives in `.data.message` (or `.data` when it's a
 * string) — pull that so we never surface a raw stack to users.
 */
export function errorText(error: unknown, fallback = "Something went wrong."): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string" && data.trim().length > 0) return data;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}
