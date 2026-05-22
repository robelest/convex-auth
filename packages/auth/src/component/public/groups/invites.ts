import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { mutation, query } from "../../functions";
import {
  vGroupInviteDoc,
  vInviteRedeemResult,
  vInviteStatus,
  vPaginated,
} from "../../model";

/**
 * Create a new platform-level invitation. Optionally set `groupId` to tie
 * the invite to a specific group. The invitation is sent to an email address
 * and includes a hashed token for secure acceptance.
 *
 * Throws `ConvexError` with code `DUPLICATE_INVITE` when a pending invite
 * already exists for the same email and scope:
 * - group invite: same `email` + same `groupId`
 * - platform invite: same `email` with no `groupId`
 *
 * When a duplicate check finds an existing invite that has passed its
 * `expiresTime`, that invite is automatically marked as `"expired"` and the
 * new invite is allowed through. CLI-generated invites (no email) skip
 * duplicate detection entirely.
 *
 * @param args.groupId - Optional `Id<"Group">` to scope this invite to a specific group. Omit for a platform-wide invite.
 * @param args.invitedByUserId - Optional `Id<"User">` of the user who issued the invitation.
 * @param args.email - Optional email address of the invitee. When provided, duplicate detection is enforced.
 * @param args.tokenHash - A pre-hashed token string used for secure, URL-safe invite acceptance.
 * @param args.roleIds - Optional array of application-defined role identifiers to assign upon acceptance.
 * @param args.status - The initial status of the invite (typically `"pending"`).
 * @param args.expiresTime - Optional Unix timestamp (ms) after which the invite is considered expired.
 * @param args.extend - Optional arbitrary payload for application-specific metadata.
 * @returns The `Id<"GroupInvite">` of the newly created invite document.
 *
 */
export const inviteCreate = mutation({
  args: {
    groupId: v.optional(v.id("Group")),
    invitedByUserId: v.optional(v.id("User")),
    email: v.optional(v.string()),
    tokenHash: v.string(),
    roleIds: v.optional(v.array(v.string())),
    status: vInviteStatus,
    expiresTime: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupInvite"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Only check for duplicates when an email is provided.
    // CLI-generated invites (no email) are always allowed.
    if (args.email !== undefined) {
      if (args.groupId !== undefined) {
        const existingGroupInvites = await ctx.db
          .query("GroupInvite")
          .withIndex("group_id_status", (q) =>
            q.eq("groupId", args.groupId).eq("status", "pending"),
          )
          .filter((q) => q.eq(q.field("email"), args.email))
          .collect();

        for (const existingGroupInvite of existingGroupInvites) {
          const isExpired =
            existingGroupInvite.expiresTime !== undefined && existingGroupInvite.expiresTime <= now;
          if (isExpired) {
            await ctx.db.patch("GroupInvite", existingGroupInvite._id, {
              status: "expired",
            });
            continue;
          }
          throw new ConvexError({
            code: "DUPLICATE_INVITE",
            message: "A pending invite already exists for this email in this group",
            email: args.email,
            groupId: args.groupId,
            existingInviteId: existingGroupInvite._id,
          });
        }
      } else {
        const existingPlatformInvites = await ctx.db
          .query("GroupInvite")
          .withIndex("email_status", (q) => q.eq("email", args.email).eq("status", "pending"))
          .filter((q) => q.eq(q.field("groupId"), undefined))
          .collect();

        for (const existingPlatformInvite of existingPlatformInvites) {
          const isExpired =
            existingPlatformInvite.expiresTime !== undefined &&
            existingPlatformInvite.expiresTime <= now;
          if (isExpired) {
            await ctx.db.patch("GroupInvite", existingPlatformInvite._id, {
              status: "expired",
            });
            continue;
          }
          throw new ConvexError({
            code: "DUPLICATE_INVITE",
            message: "A pending platform invite already exists for this email",
            email: args.email,
            existingInviteId: existingPlatformInvite._id,
          });
        }
      }
    }
    return await ctx.db.insert("GroupInvite", args);
  },
});

/**
 * Read an invite by identity — one function, all-optional args, unioned
 * return: `{ id }` (point lookup) or `{ tokenHash }` (token index).
 *
 */
export const inviteGet = query({
  args: {
    id: v.optional(v.id("GroupInvite")),
    tokenHash: v.optional(v.string()),
  },
  returns: v.union(vGroupInviteDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.tokenHash !== undefined) {
      return await ctx.db
        .query("GroupInvite")
        .withIndex("token_hash", (q) => q.eq("tokenHash", args.tokenHash!))
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("GroupInvite", args.id);
  },
});


/**
 * List invites with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `groupId`,
 * `status`, `email`, `invitedByUserId`, `roleId`, `acceptedByUserId`, and
 * `tokenHash`. The query engine automatically selects the best compound
 * index based on the combination of filter fields provided. The `roleId`
 * filter is applied in-memory after the index scan because role IDs are
 * stored as an array.
 *
 * @param args.where - Optional filter criteria for narrowing results.
 * @param args.where.tokenHash - Match invites with this exact hashed token.
 * @param args.where.groupId - Match invites scoped to this group.
 * @param args.where.status - Match invites with this status (e.g. `"pending"`, `"accepted"`, `"revoked"`).
 * @param args.where.email - Match invites sent to this email address.
 * @param args.where.invitedByUserId - Match invites created by this user.
 * @param args.where.roleId - Match invites that include this role identifier in their `roleIds` array.
 * @param args.where.acceptedByUserId - Match invites accepted by this specific user.
 * @param args.paginationOpts - Convex `paginationOptsValidator` shape
 *   (`{ numItems, cursor }`).
 * @param args.orderBy - The field to sort by: `"_creationTime"`, `"status"`, `"email"`, `"expiresTime"`, or `"acceptedTime"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (defaults to `"desc"`).
 * @returns A Convex `PaginationResult<GroupInviteDoc>` — `{ page, isDone, continueCursor }`.
 *
 */
export const inviteList = query({
  args: {
    where: v.optional(
      v.object({
        tokenHash: v.optional(v.string()),
        groupId: v.optional(v.id("Group")),
        status: v.optional(vInviteStatus),
        email: v.optional(v.string()),
        invitedByUserId: v.optional(v.id("User")),
        roleId: v.optional(v.string()),
        acceptedByUserId: v.optional(v.id("User")),
      }),
    ),
    paginationOpts: paginationOptsValidator,
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("status"),
        v.literal("email"),
        v.literal("expiresTime"),
        v.literal("acceptedTime"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupInviteDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const order = args.order ?? "desc";

    // Pick best index
    let q;
    if (where.tokenHash !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("token_hash", (idx) => idx.eq("tokenHash", where.tokenHash!));
    } else if (where.groupId !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("group_id_status", (idx) =>
          idx.eq("groupId", where.groupId!).eq("status", where.status!),
        );
    } else if (where.email !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("email_status", (idx) =>
          idx.eq("email", where.email!).eq("status", where.status!),
        );
    } else if (where.invitedByUserId !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("invited_by_user_id_status", (idx) =>
          idx.eq("invitedByUserId", where.invitedByUserId!).eq("status", where.status!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.status !== undefined) {
      q = ctx.db.query("GroupInvite").withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("GroupInvite");
    }

    // Apply remaining filters
    if (where.groupId !== undefined) {
      q = q.filter((f) => f.eq(f.field("groupId"), where.groupId!));
    }
    if (where.status !== undefined) {
      q = q.filter((f) => f.eq(f.field("status"), where.status!));
    }
    if (where.email !== undefined) {
      q = q.filter((f) => f.eq(f.field("email"), where.email!));
    }
    if (where.invitedByUserId !== undefined) {
      q = q.filter((f) => f.eq(f.field("invitedByUserId"), where.invitedByUserId!));
    }
    if (where.acceptedByUserId !== undefined) {
      q = q.filter((f) => f.eq(f.field("acceptedByUserId"), where.acceptedByUserId!));
    }
    if (where.tokenHash !== undefined) {
      q = q.filter((f) => f.eq(f.field("tokenHash"), where.tokenHash!));
    }

    const result = await q.order(order).paginate(args.paginationOpts);
    if (where.roleId === undefined) {
      return result;
    }
    return {
      ...result,
      page: result.page.filter((doc) => (doc.roleIds ?? []).includes(where.roleId!)),
    };
  },
});

/**
 * Accept a pending invitation.
 *
 * Marks the invite as `"accepted"` and records the acceptance timestamp.
 * Throws a structured `ConvexError` when the invite doesn't exist or is not
 * currently pending. If the invite has passed its `expiresTime`, it is
 * automatically transitioned to `"expired"` and the acceptance is rejected.
 *
 * The caller is responsible for creating the corresponding member record
 * (see {@link inviteRedeem} for an all-in-one alternative that also
 * handles membership).
 *
 * @param args.inviteId - The `Id<"GroupInvite">` of the invite to accept.
 * @param args.acceptedByUserId - Optional `Id<"User">` of the user accepting the invite. Stored on the invite for audit purposes.
 * @returns `null` on success.
 * @throws `ConvexError` with code `INVITE_NOT_FOUND` if the invite does not exist.
 * @throws `ConvexError` with code `INVITE_NOT_PENDING` if the invite has already been accepted, revoked, or otherwise finalized.
 * @throws `ConvexError` with code `INVITE_EXPIRED` if the invite's `expiresTime` has passed.
 *
 */
export const inviteAccept = mutation({
  args: {
    inviteId: v.id("GroupInvite"),
    acceptedByUserId: v.optional(v.id("User")),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId, acceptedByUserId }) => {
    const invite = await ctx.db.get("GroupInvite", inviteId);
    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
        inviteId,
      });
    }
    if (invite.status !== "pending") {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot accept invite with status "${invite.status}"`,
        inviteId,
        currentStatus: invite.status,
      });
    }
    if (invite.expiresTime !== undefined && invite.expiresTime <= Date.now()) {
      await ctx.db.patch("GroupInvite", inviteId, {
        status: "expired",
      });
      throw new ConvexError({
        code: "INVITE_EXPIRED",
        message: "Invite has expired",
        inviteId,
      });
    }
    await ctx.db.patch("GroupInvite", inviteId, {
      status: "accepted",
      acceptedTime: Date.now(),
      ...(acceptedByUserId ? { acceptedByUserId } : {}),
    });
    return null;
  },
});

/**
 * Accept an invitation by raw token hash and atomically join group membership.
 *
 * This is the primary token-based acceptance flow. It looks up the invite by
 * `tokenHash`, validates status and expiry, verifies the accepting user's
 * email matches the invite email (when set), and — if the invite is scoped
 * to a group — creates a `GroupMember` record in the same transaction.
 *
 * The operation is idempotent: if the invite was already accepted by the
 * same user, it returns a result with `inviteStatus: "already_accepted"`
 * and the existing membership information.
 *
 * @param args.tokenHash - The hashed token string that identifies the invite (typically extracted from an invite URL).
 * @param args.acceptedByUserId - The `Id<"User">` of the user accepting the invitation. Their email must match the invite's email when one was specified.
 * @returns An object describing the outcome:
 *   - `inviteId` — the ID of the accepted invite.
 *   - `groupId` — the group the invite targets, or `null` for platform invites.
 *   - `memberId` — the ID of the created (or existing) member record, or `undefined` for platform invites.
 *   - `inviteStatus` — `"accepted"` for a fresh acceptance, `"already_accepted"` for idempotent replays.
 *   - `membershipStatus` — `"joined"`, `"already_joined"`, or `"not_applicable"`.
 * @throws `ConvexError` with code `INVITE_NOT_FOUND` if no invite matches the token hash.
 * @throws `ConvexError` with code `INVITE_EXPIRED` if the invite's `expiresTime` has passed.
 * @throws `ConvexError` with code `INVITE_ALREADY_ACCEPTED` if the invite was accepted by a different user.
 * @throws `ConvexError` with code `INVITE_NOT_PENDING` if the invite has been revoked or is in another non-pending state.
 * @throws `ConvexError` with code `INVITE_EMAIL_MISMATCH` if the accepting user's email does not match the invite's email.
 *
 */
export const inviteRedeem = mutation({
  args: {
    tokenHash: v.string(),
    acceptedByUserId: v.id("User"),
  },
  returns: vInviteRedeemResult,
  handler: async (ctx, { tokenHash, acceptedByUserId }) => {
    const invite = await ctx.db
      .query("GroupInvite")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
      });
    }

    const now = Date.now();
    if (invite.status === "pending") {
      if (invite.expiresTime !== undefined && invite.expiresTime <= now) {
        await ctx.db.patch("GroupInvite", invite._id, { status: "expired" });
        throw new ConvexError({
          code: "INVITE_EXPIRED",
          message: "Invite has expired",
          inviteId: invite._id,
        });
      }
    } else if (invite.status === "accepted") {
      if (invite.acceptedByUserId !== acceptedByUserId) {
        throw new ConvexError({
          code: "INVITE_ALREADY_ACCEPTED",
          message: "Invite already accepted by another user",
          inviteId: invite._id,
        });
      }
    } else {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot accept invite with status "${invite.status}"`,
        inviteId: invite._id,
        currentStatus: invite.status,
      });
    }

    if (invite.email !== undefined) {
      const user = await ctx.db.get("User", acceptedByUserId);
      const normalizedInviteEmail = invite.email.trim().toLowerCase();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (normalizedUserEmail === undefined || normalizedUserEmail !== normalizedInviteEmail) {
        throw new ConvexError({
          code: "INVITE_EMAIL_MISMATCH",
          message: "Invite email does not match accepting user's email",
          inviteId: invite._id,
        });
      }
    }

    let membershipStatus: "joined" | "already_joined" | "not_applicable" = "not_applicable";
    let memberId: Id<"GroupMember"> | undefined;

    if (invite.groupId !== undefined) {
      const existingMembership = await ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (q) =>
          q.eq("groupId", invite.groupId!).eq("userId", acceptedByUserId),
        )
        .unique();

      if (existingMembership !== null) {
        membershipStatus = "already_joined";
        memberId = existingMembership._id;
      } else {
        memberId = await ctx.db.insert("GroupMember", {
          groupId: invite.groupId,
          userId: acceptedByUserId,
          roleIds: invite.roleIds,
          status: "active",
        });
        membershipStatus = "joined";
      }
    }

    if (invite.status === "pending") {
      await ctx.db.patch("GroupInvite", invite._id, {
        status: "accepted",
        acceptedByUserId,
        acceptedTime: now,
      });
    }

    const inviteStatus: "accepted" | "already_accepted" =
      invite.status === "accepted" ? "already_accepted" : "accepted";

    return {
      inviteId: invite._id,
      groupId: invite.groupId ?? null,
      memberId,
      inviteStatus,
      membershipStatus,
    };
  },
});

/**
 * Revoke a pending invitation.
 *
 * Marks the invite as `"revoked"`. Only invites with status `"pending"` can
 * be revoked. Throws a structured `ConvexError` when the invite doesn't
 * exist or is not currently pending. Once revoked, the invite's token can
 * no longer be used for acceptance.
 *
 * @param args.inviteId - The `Id<"GroupInvite">` of the invite to revoke.
 * @returns `null` on success.
 * @throws `ConvexError` with code `INVITE_NOT_FOUND` if the invite does not exist.
 * @throws `ConvexError` with code `INVITE_NOT_PENDING` if the invite has already been accepted, revoked, or expired.
 *
 */
export const inviteRevoke = mutation({
  args: { inviteId: v.id("GroupInvite") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("GroupInvite", inviteId);
    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
        inviteId,
      });
    }
    if (invite.status !== "pending") {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot revoke invite with status "${invite.status}"`,
        inviteId,
        currentStatus: invite.status,
      });
    }
    await ctx.db.patch("GroupInvite", inviteId, { status: "revoked" });
    return null;
  },
});
