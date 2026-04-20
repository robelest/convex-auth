import type { UserIdentity } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

/** @internal */
export function userIdFromIdentitySubject(subject: string): string {
  if (typeof subject !== "string" || subject.length === 0) {
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "Authenticated identity subject is malformed.",
    });
  }
  return subject;
}

/** @internal */
export function userIdFromIdentity(identity: UserIdentity): GenericId<"User"> {
  return userIdFromIdentitySubject(identity.subject) as GenericId<"User">;
}

/** @internal */
export function sessionIdFromIdentity(identity: UserIdentity): GenericId<"Session"> {
  const sessionId = identity.sid;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "Authenticated identity is missing a session id claim.",
    });
  }
  return sessionId as GenericId<"Session">;
}

/** @internal */
export async function getUserIdentityOrNull(ctx: {
  auth: { getUserIdentity: () => Promise<UserIdentity | null> };
}) {
  return await ctx.auth.getUserIdentity();
}

/** @internal */
export async function getAuthenticatedUserIdOrNull(ctx: {
  auth: { getUserIdentity: () => Promise<UserIdentity | null> };
}) {
  const identity = await getUserIdentityOrNull(ctx);
  return identity === null ? null : userIdFromIdentity(identity);
}

/** @internal */
export async function getAuthenticatedSessionIdOrNull(ctx: {
  auth: { getUserIdentity: () => Promise<UserIdentity | null> };
}) {
  const identity = await getUserIdentityOrNull(ctx);
  return identity === null ? null : sessionIdFromIdentity(identity);
}
