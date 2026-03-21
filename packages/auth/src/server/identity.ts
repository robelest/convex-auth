import { AuthError } from "./fx";

/** @internal */
export function userIdFromIdentitySubject(subject: string): string {
  const [userId, ...rest] = subject.split("|");
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    rest.length === 0 ||
    rest.some((segment) => segment.length === 0)
  ) {
    throw new AuthError(
      "INTERNAL_ERROR",
      "Authenticated identity subject is malformed.",
    );
  }
  return userId;
}
