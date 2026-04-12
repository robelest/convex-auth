import { ConvexError } from "convex/values";

/** @internal */
export function userIdFromIdentitySubject(subject: string): string {
  const [userId, ...rest] = subject.split("|");
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    rest.length === 0 ||
    rest.some((segment) => segment.length === 0)
  ) {
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "Authenticated identity subject is malformed.",
    });
  }
  return userId;
}
