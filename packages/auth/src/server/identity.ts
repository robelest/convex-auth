import { Cv } from "@robelest/fx/convex";

/** @internal */
export function userIdFromIdentitySubject(subject: string): string {
  const [userId, ...rest] = subject.split("|");
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    rest.length === 0 ||
    rest.some((segment) => segment.length === 0)
  ) {
    throw Cv.error({
      code: "INTERNAL_ERROR",
      message: "Authenticated identity subject is malformed.",
    });
  }
  return userId;
}
