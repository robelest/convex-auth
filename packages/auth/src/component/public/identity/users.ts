import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import { mutation, query } from "../../functions";
import { vPaginated, vUserDoc, vUserEmailDoc, vUserEmailSource } from "../../model";

const vUserInsertData = v.object({
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  lastActiveGroup: v.optional(v.id("Group")),
  hasTotp: v.optional(v.boolean()),
  extend: v.optional(v.any()),
});

/**
 * List users with optional filtering, sorting, and cursor-based pagination.
 *
 * Supports filtering by `email`, `phone`, `isAnonymous`, and `name`. When an
 * `email` or `phone` filter is provided, the corresponding database index is
 * used for efficient lookup; other filters are applied in-memory. Returns a
 * Convex-native `PaginationResult<UserDoc>` so consumers can pass the query
 * directly to `usePaginatedQuery`.
 *
 * @param args.where - Optional filter object. Fields: `email` (exact match),
 *   `phone` (exact match), `isAnonymous` (boolean), `name` (exact match).
 * @param args.paginationOpts - Convex `paginationOptsValidator` shape
 *   (`{ numItems, cursor }`).
 * @param args.orderBy - The field to sort results by. One of `"_creationTime"`,
 *   `"name"`, `"email"`, or `"phone"`. Defaults to `"_creationTime"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (default `"desc"`).
 * @returns A Convex `PaginationResult<UserDoc>` — `{ page, isDone, continueCursor }`.
 *
 */
export const userList = query({
  args: {
    where: v.optional(
      v.object({
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        isAnonymous: v.optional(v.boolean()),
        name: v.optional(v.string()),
      }),
    ),
    paginationOpts: paginationOptsValidator,
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("email"),
        v.literal("phone"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vUserDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const order = args.order ?? "desc";

    let q;
    if (where.email !== undefined) {
      q = ctx.db.query("User").withIndex("email", (idx) => idx.eq("email", where.email!));
    } else if (where.phone !== undefined) {
      q = ctx.db.query("User").withIndex("phone", (idx) => idx.eq("phone", where.phone!));
    } else {
      q = ctx.db.query("User");
    }

    if (where.isAnonymous !== undefined) {
      q = q.filter((f) => f.eq(f.field("isAnonymous"), where.isAnonymous!));
    }
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    if (where.email !== undefined && where.phone !== undefined) {
      q = q.filter((f) => f.eq(f.field("phone"), where.phone!));
    }

    return await q.order(order).paginate(args.paginationOpts);
  },
});


/**
 * Insert a new user document into the `User` table.
 *
 * Creates a brand-new user record. The `data` argument should conform to the
 * User table schema (e.g. `name`, `email`, `phone`, `isAnonymous`, `image`,
 * `extend`), but is typed as `any` to allow flexible extension.
 *
 * @param args.data - The user document fields to insert. Typically includes `name`,
 *   `email`, `isAnonymous`, and any custom fields under `extend`.
 * @returns The document ID of the newly created user.
 *
 */
export const userInsert = mutation({
  args: { data: vUserInsertData },
  returns: v.id("User"),
  handler: async (ctx, { data }) => {
    return await ctx.db.insert("User", data);
  },
});

/**
 * Insert a new user or update an existing one (upsert).
 *
 * When `userId` is provided and refers to an existing user, the document is
 * patched with the supplied `data` and the same `userId` is returned. When
 * `userId` is omitted or `undefined`, a new user document is inserted and its
 * generated ID is returned. This is the primary mechanism used during sign-in
 * flows to either create or refresh user profile data.
 *
 * @param args.userId - The document ID of an existing user to update. If `undefined`,
 *   a new user is created instead.
 * @param args.data - The user document fields to insert or merge. Accepts the same
 *   shape as the User table schema.
 * @returns The document ID of the created or updated user.
 *
 */
export const userUpsert = mutation({
  args: { userId: v.optional(v.id("User")), data: vUserInsertData },
  returns: v.id("User"),
  handler: async (ctx, { userId, data }) => {
    if (userId !== undefined) {
      await ctx.db.patch("User", userId, data);
      return userId;
    }
    return await ctx.db.insert("User", data);
  },
});

/**
 * Patch an existing user document with partial data.
 *
 * Merges the provided fields into the existing user document. Fields not
 * included in `data` are left unchanged. Useful for updating profile
 * information such as `name`, `email`, or custom `extend` fields without
 * overwriting the entire document.
 *
 * @param args.userId - The document ID of the user to update.
 * @param args.data - A partial object containing the fields to merge into the user document.
 * @returns `null` on success.
 *
 */
const vUserPatchData = v.object({
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  lastActiveGroup: v.optional(v.id("Group")),
  hasTotp: v.optional(v.boolean()),
  extend: v.optional(v.any()),
});

export const userPatch = mutation({
  args: { userId: v.id("User"), data: vUserPatchData },
  returns: v.null(),
  handler: async (ctx, { userId, data }) => {
    await ctx.db.patch("User", userId, data);
    return null;
  },
});

/**
 * Delete a user document by ID.
 *
 * Removes the user from the `User` table. This is a no-op if the user does not
 * exist (i.e. was already deleted). Callers should ensure that related resources
 * such as accounts, sessions, and refresh tokens are cleaned up separately.
 *
 * @param args.userId - The document ID of the user to delete.
 * @returns `null` on success (including when the user was already absent).
 *
 */
export const userDelete = mutation({
  args: {
    userId: v.id("User"),
    /**
     * When true, atomically cascade-delete every record linked to the
     * user: sessions, refresh tokens, accounts, group memberships, API
     * keys, passkeys, and TOTP factors — then the user document itself.
     *
     * When false (or omitted), deletes only the user row. If any linked
     * data exists, the mutation throws `INVALID_PARAMETERS` to prevent
     * orphaned records.
     *
     * Consolidating the cascade inside the component saves the
     * `1 + 6 + N` cross-component RPCs the app-side resolver previously
     * issued.
     */
    cascade: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, cascade }) => {
    const user = await ctx.db.get("User", userId);
    if (user === null) return null;

    if (cascade !== true) {
      const [session, account, key, member, passkey, totp] = await Promise.all([
        ctx.db
          .query("Session")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("Account")
          .withIndex("user_id_provider", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("ApiKey")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("GroupMember")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("Passkey")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .first(),
        ctx.db
          .query("TotpFactor")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .first(),
      ]);
      if (
        session !== null ||
        account !== null ||
        key !== null ||
        member !== null ||
        passkey !== null ||
        totp !== null
      ) {
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "The provided parameters are invalid.",
        });
      }
    }

    if (cascade === true) {
      const CASCADE_MAX = 1000;
      const tooMany = (count: number) => count > CASCADE_MAX;
      const [sessions, accounts, keys, members, passkeys, totps] = await Promise.all([
        ctx.db
          .query("Session")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .take(CASCADE_MAX + 1),
        ctx.db
          .query("Account")
          .withIndex("user_id_provider", (q) => q.eq("userId", userId))
          .take(CASCADE_MAX + 1),
        ctx.db
          .query("ApiKey")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .take(CASCADE_MAX + 1),
        ctx.db
          .query("GroupMember")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .take(CASCADE_MAX + 1),
        ctx.db
          .query("Passkey")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .take(CASCADE_MAX + 1),
        ctx.db
          .query("TotpFactor")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .take(CASCADE_MAX + 1),
      ]);
      if (
        tooMany(sessions.length) ||
        tooMany(accounts.length) ||
        tooMany(keys.length) ||
        tooMany(members.length) ||
        tooMany(passkeys.length) ||
        tooMany(totps.length)
      ) {
        throw new ConvexError({
          code: "CASCADE_TOO_LARGE",
          message: `User has more than ${CASCADE_MAX} child rows in one or more tables; cascade delete is not safe in a single mutation. Use the migrations component to drain children first, then call delete without cascade.`,
        });
      }
      const refreshTokens =
        sessions.length > 0
          ? (
              await Promise.all(
                sessions.map((s) =>
                  ctx.db
                    .query("RefreshToken")
                    .withIndex("session_id", (q) => q.eq("sessionId", s._id))
                    .take(CASCADE_MAX + 1),
                ),
              )
            ).flat()
          : [];
      if (tooMany(refreshTokens.length)) {
        throw new ConvexError({
          code: "CASCADE_TOO_LARGE",
          message: `User has more than ${CASCADE_MAX} refresh tokens across sessions; cascade delete is not safe in a single mutation.`,
        });
      }
      await Promise.all([
        ...sessions.map((s) => ctx.db.delete("Session", s._id)),
        ...refreshTokens.map((r) => ctx.db.delete("RefreshToken", r._id)),
        ...accounts.map((a) => ctx.db.delete("Account", a._id)),
        ...keys.map((k) => ctx.db.delete("ApiKey", k._id)),
        ...members.map((m) => ctx.db.delete("GroupMember", m._id)),
        ...passkeys.map((p) => ctx.db.delete("Passkey", p._id)),
        ...totps.map((t) => ctx.db.delete("TotpFactor", t._id)),
      ]);
    }
    const ownedEmails = await ctx.db
      .query("UserEmail")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
    await Promise.all(ownedEmails.map((e) => ctx.db.delete("UserEmail", e._id)));

    await ctx.db.delete("User", userId);
    return null;
  },
});

/**
 * List every email a user owns (across providers/SSO connections).
 *
 * @param args.userId - The user whose emails to list.
 * @returns The user's `UserEmail` documents (may be empty).
 *
 */
export const userEmailListByUser = query({
  args: { userId: v.id("User") },
  returns: v.array(vUserEmailDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("UserEmail")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Find a verified-email owner, optionally scoped to a single SSO
 * connection. Returns the matching user document if exactly one verified
 * `UserEmail` matches (preserving the "one-or-null" linking contract).
 *
 * Pass `connectionId` for SSO logins so a verified email only matches a
 * row asserted by that same connection — never across IdPs.
 *
 * @param args.email - Email address (exact match).
 * @param args.connectionId - Restrict to this connection's emails (SSO).
 * @returns The owning user document, or `null` when zero or 2+ match.
 *
 */
export const userEmailOwner = query({
  args: { email: v.string(), connectionId: v.optional(v.id("GroupConnection")) },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { email, connectionId }) => {
    const rows =
      connectionId === undefined
        ? await ctx.db
            .query("UserEmail")
            .withIndex("email_verified", (q) =>
              q.eq("email", email).gt("verificationTime", undefined),
            )
            .take(2)
        : (
            await ctx.db
              .query("UserEmail")
              .withIndex("connection_id_email", (q) =>
                q.eq("connectionId", connectionId).eq("email", email),
              )
              .take(2)
          ).filter((r) => typeof r.verificationTime === "number");
    if (rows.length !== 1) return null;
    return await ctx.db.get("User", rows[0].userId);
  },
});

/**
 * Record (insert or update) an email a user owns. When `isPrimary` is
 * `true`, any existing primary for the user is demoted and the
 * denormalized `User.email` / `emailVerificationTime` pointer is synced.
 *
 * Keyed by `(userId, email)`. Provenance (`source`, `connectionId`,
 * `accountId`, `provider`) is recorded so SSO linking can stay
 * connection-scoped.
 *
 * @param args.userId - Owner of the email.
 * @param args.email - The email address (store lowercased).
 * @param args.verified - Mark verified (sets `verificationTime`).
 * @param args.isPrimary - Promote to the user's primary email.
 * @param args.source - Which mechanism asserted it (`oauth`, `saml`, …).
 * @param args.accountId - Originating account, when applicable.
 * @param args.provider - Originating provider id, when applicable.
 * @param args.connectionId - Originating SSO connection, when applicable.
 * @returns The `UserEmail` document ID.
 *
 */
export const userEmailUpsert = mutation({
  args: {
    userId: v.id("User"),
    email: v.string(),
    verified: v.optional(v.boolean()),
    isPrimary: v.optional(v.boolean()),
    source: vUserEmailSource,
    accountId: v.optional(v.id("Account")),
    provider: v.optional(v.string()),
    connectionId: v.optional(v.id("GroupConnection")),
  },
  returns: v.id("UserEmail"),
  handler: async (ctx, args) => {
    const owned = await ctx.db
      .query("UserEmail")
      .withIndex("user_id", (q) => q.eq("userId", args.userId))
      .collect();
    const existing = owned.find((e) => e.email === args.email) ?? null;
    const makePrimary = args.isPrimary === true || owned.length === 0;
    const verificationTime =
      args.verified === true
        ? (existing?.verificationTime ?? Date.now())
        : existing?.verificationTime;

    if (makePrimary) {
      await Promise.all(
        owned
          .filter((e) => e.isPrimary && e._id !== existing?._id)
          .map((e) => ctx.db.patch("UserEmail", e._id, { isPrimary: false })),
      );
    }

    let id;
    if (existing !== null) {
      await ctx.db.patch("UserEmail", existing._id, {
        verificationTime,
        isPrimary: makePrimary ? true : existing.isPrimary,
        source: args.source,
        accountId: args.accountId ?? existing.accountId,
        provider: args.provider ?? existing.provider,
        connectionId: args.connectionId ?? existing.connectionId,
      });
      id = existing._id;
    } else {
      id = await ctx.db.insert("UserEmail", {
        userId: args.userId,
        email: args.email,
        verificationTime,
        isPrimary: makePrimary,
        source: args.source,
        accountId: args.accountId,
        provider: args.provider,
        connectionId: args.connectionId,
      });
    }

    if (makePrimary) {
      await ctx.db.patch("User", args.userId, {
        email: args.email,
        ...(verificationTime !== undefined
          ? { emailVerificationTime: verificationTime }
          : {}),
      });
    }
    return id;
  },
});

/**
 * Promote one of the user's emails to primary, syncing the denormalized
 * `User.email` / `emailVerificationTime` pointer. The target must exist
 * and be verified.
 *
 * @param args.userId - Owner of the email.
 * @param args.email - The address to promote (must be owned + verified).
 * @returns `null`.
 * @throws `INVALID_PARAMETERS` if the email is not owned or not verified.
 *
 */
export const userEmailSetPrimary = mutation({
  args: { userId: v.id("User"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    const owned = await ctx.db
      .query("UserEmail")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
    const target = owned.find((e) => e.email === email);
    if (target === undefined) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Email is not owned by this user.",
      });
    }
    if (target.verificationTime === undefined) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Cannot make an unverified email primary.",
      });
    }
    await Promise.all(
      owned
        .filter((e) => e.isPrimary && e._id !== target._id)
        .map((e) => ctx.db.patch("UserEmail", e._id, { isPrimary: false })),
    );
    await ctx.db.patch("UserEmail", target._id, { isPrimary: true });
    await ctx.db.patch("User", userId, {
      email: target.email,
      emailVerificationTime: target.verificationTime,
    });
    return null;
  },
});

/**
 * Remove an email a user owns. Guards: cannot remove the primary, the
 * last verified email, or a connection-managed row (`saml`/`oidc`/`scim`
 * with a `connectionId` — owned by the IdP/SCIM, not the user).
 *
 * @param args.userId - Owner of the email.
 * @param args.email - The address to remove (must be owned).
 * @returns `null`.
 * @throws `INVALID_PARAMETERS` if not owned, primary, the only verified
 *   email, or connection-managed.
 *
 */
export const userEmailRemove = mutation({
  args: { userId: v.id("User"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    const owned = await ctx.db
      .query("UserEmail")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
    const target = owned.find((e) => e.email === email);
    if (target === undefined) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Email is not owned by this user.",
      });
    }
    if (target.isPrimary) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Cannot remove the primary email; set another primary first.",
      });
    }
    if (
      target.connectionId !== undefined &&
      (target.source === "saml" || target.source === "oidc" || target.source === "scim")
    ) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "This email is managed by an SSO/SCIM connection.",
      });
    }
    const verifiedCount = owned.filter((e) => e.verificationTime !== undefined).length;
    if (target.verificationTime !== undefined && verifiedCount <= 1) {
      throw new ConvexError({
        code: "INVALID_PARAMETERS",
        message: "Cannot remove the only verified email.",
      });
    }
    await ctx.db.delete("UserEmail", target._id);
    return null;
  },
});

// ============================================================================
// Accounts
// ============================================================================
