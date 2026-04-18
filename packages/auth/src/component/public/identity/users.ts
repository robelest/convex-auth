import { ConvexError, v } from "convex/values";

import { mutation, query } from "../../functions";
import { vPaginated, vUserDoc } from "../../model";

/**
 * List users with optional filtering, sorting, and cursor-based pagination.
 *
 * Supports filtering by `email`, `phone`, `isAnonymous`, and `name`. When an
 * `email` or `phone` filter is provided, the corresponding database index is
 * used for efficient lookup; other filters are applied in-memory. Results are
 * returned as a paginated response `{ items, nextCursor }` -- pass `nextCursor`
 * back as `cursor` to fetch the next page, or receive `null` when all results
 * have been exhausted.
 *
 * @param args.where - Optional filter object. Fields: `email` (exact match),
 *   `phone` (exact match), `isAnonymous` (boolean), `name` (exact match).
 * @param args.limit - Maximum number of users to return per page (1--100, default 50).
 * @param args.cursor - An opaque cursor string from a previous response's `nextCursor`
 *   to continue pagination, or `null` / omitted to start from the beginning.
 * @param args.orderBy - The field to sort results by. One of `"_creationTime"`,
 *   `"name"`, `"email"`, or `"phone"`. Defaults to `"_creationTime"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (default `"desc"`).
 * @returns An object with `items` (array of user documents) and `nextCursor`
 *   (`string | null`) for fetching subsequent pages.
 *
 * @example
 * ```ts
 * // Fetch the first page of non-anonymous users
 * const page1 = await ctx.runQuery(
 *   component.identity.users.userList,
 *   { where: { isAnonymous: false }, limit: 20 },
 * );
 * console.log(page1.items);
 *
 * // Fetch the next page
 * if (page1.nextCursor !== null) {
 *   const page2 = await ctx.runQuery(
 *     component.identity.users.userList,
 *     { where: { isAnonymous: false }, limit: 20, cursor: page1.nextCursor },
 *   );
 * }
 * ```
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
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
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
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    // Pick index based on where fields
    let q;
    if (where.email !== undefined) {
      q = ctx.db.query("User").withIndex("email", (idx) => idx.eq("email", where.email!));
    } else if (where.phone !== undefined) {
      q = ctx.db.query("User").withIndex("phone", (idx) => idx.eq("phone", where.phone!));
    } else {
      q = ctx.db.query("User");
    }

    // Apply remaining filters
    if (where.isAnonymous !== undefined) {
      q = q.filter((f) => f.eq(f.field("isAnonymous"), where.isAnonymous!));
    }
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    // email/phone filters when not used as index
    if (where.email !== undefined && where.phone !== undefined) {
      q = q.filter((f) => f.eq(f.field("phone"), where.phone!));
    }

    q = q.order(order);

    // Cursor-based pagination: skip past the cursor ID
    const all = await q.collect();
    let startIdx = 0;
    if (args.cursor) {
      const cursorIdx = all.findIndex((doc) => doc._id === args.cursor);
      if (cursorIdx !== -1) {
        startIdx = cursorIdx + 1;
      }
    }
    const page = all.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor };
  },
});

/**
 * Retrieve a single user by their Convex document ID.
 *
 * Performs a direct point lookup on the `User` table. Returns `null` if the
 * user has been deleted or never existed.
 *
 * @param args.userId - The Convex document ID (`Id<"User">`) of the user to retrieve.
 * @returns The user document if it exists, or `null` otherwise.
 *
 * @example
 * ```ts
 * const user = await ctx.runQuery(
 *   component.identity.users.userGetById,
 *   { userId: session.userId },
 * );
 * if (user !== null) {
 *   console.log(`Name: ${user.name}, Email: ${user.email}`);
 * }
 * ```
 */
export const userGetById = query({
  args: { userId: v.id("User") },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db.get("User", userId);
  },
});

/**
 * Fetch many user documents by ID in a single component round-trip.
 *
 * Equivalent to calling {@link userGetById} for each ID in parallel from the
 * app side, but collapses what would be `N` cross-component RPCs into one.
 * Returns the documents in the same order as the input IDs; missing users
 * appear as `null`. Input is de-duplicated internally so passing the same
 * ID twice costs exactly one `ctx.db.get`.
 *
 * Hot paths like `groups:getDashboard` (member summaries) and
 * `issues:projectIssues` (assignee/creator lookups) previously fanned out
 * N `userGetById` calls — this helper is the batched replacement.
 *
 * @param args.userIds - Array of user document IDs (order preserved, duplicates tolerated).
 * @returns Array of user documents or `null` entries, in the same order as `args.userIds`.
 *
 * @example
 * ```ts
 * const users = await ctx.runQuery(
 *   component.identity.users.userGetMany,
 *   { userIds: memberIds },
 * );
 * const byId = new Map(users.filter(u => u !== null).map(u => [u!._id, u!]));
 * ```
 */
export const userGetMany = query({
  args: { userIds: v.array(v.id("User")) },
  returns: v.array(v.union(vUserDoc, v.null())),
  handler: async (ctx, { userIds }) => {
    if (userIds.length === 0) return [];
    const unique = Array.from(new Set(userIds));
    const docs = await Promise.all(unique.map((id) => ctx.db.get("User", id)));
    const byId = new Map(unique.map((id, i) => [id, docs[i] ?? null]));
    return userIds.map((id) => byId.get(id) ?? null);
  },
});

/**
 * Find a user by their verified email address.
 *
 * Queries the `User` table using the `email_verified` index to locate users
 * whose `email` matches and whose `emailVerificationTime` is set. If exactly
 * one user is found, that document is returned. Returns `null` if no user has
 * this email verified or if multiple users share the same verified email
 * (an ambiguous state that should not occur in normal operation).
 *
 * @param args.email - The verified email address to search for (case-sensitive, exact match).
 * @returns The matching user document if exactly one verified user is found, or `null` otherwise.
 *
 * @example
 * ```ts
 * const user = await ctx.runQuery(
 *   component.identity.users.userFindByVerifiedEmail,
 *   { email: "alice@example.com" },
 * );
 * if (user !== null) {
 *   console.log(`Found verified user: ${user._id}`);
 * }
 * ```
 */
export const userFindByVerifiedEmail = query({
  args: { email: v.string() },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { email }) => {
    const users = await ctx.db
      .query("User")
      .withIndex("email_verified", (q) =>
        q.eq("email", email).gt("emailVerificationTime", undefined),
      )
      .take(2);
    return users.length === 1 ? users[0] : null;
  },
});

/**
 * Find a user by their verified phone number.
 *
 * Queries the `User` table using the `phone_verified` index to locate users
 * whose `phone` matches and whose `phoneVerificationTime` is set. If exactly
 * one user is found, that document is returned. Returns `null` if no user has
 * this phone verified or if multiple users share the same verified phone
 * (an ambiguous state that should not occur in normal operation).
 *
 * @param args.phone - The verified phone number to search for (exact match, e.g. `"+15551234567"`).
 * @returns The matching user document if exactly one verified user is found, or `null` otherwise.
 *
 * @example
 * ```ts
 * const user = await ctx.runQuery(
 *   component.identity.users.userFindByVerifiedPhone,
 *   { phone: "+15551234567" },
 * );
 * if (user !== null) {
 *   console.log(`Found verified user: ${user._id}`);
 * }
 * ```
 */
export const userFindByVerifiedPhone = query({
  args: { phone: v.string() },
  returns: v.union(vUserDoc, v.null()),
  handler: async (ctx, { phone }) => {
    const users = await ctx.db
      .query("User")
      .withIndex("phone_verified", (q) =>
        q.eq("phone", phone).gt("phoneVerificationTime", undefined),
      )
      .take(2);
    return users.length === 1 ? users[0] : null;
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
 * @example
 * ```ts
 * const userId = await ctx.runMutation(
 *   component.identity.users.userInsert,
 *   {
 *     data: {
 *       name: "Alice",
 *       email: "alice@example.com",
 *       isAnonymous: false,
 *     },
 *   },
 * );
 * ```
 */
export const userInsert = mutation({
  args: { data: v.any() },
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
 * @example
 * ```ts
 * // Create a new user if none exists, or update the existing one
 * const userId = await ctx.runMutation(
 *   component.identity.users.userUpsert,
 *   {
 *     userId: existingUserId ?? undefined,
 *     data: { name: "Alice", email: "alice@example.com" },
 *   },
 * );
 * ```
 */
export const userUpsert = mutation({
  args: { userId: v.optional(v.id("User")), data: v.any() },
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
 * @example
 * ```ts
 * await ctx.runMutation(
 *   component.identity.users.userPatch,
 *   {
 *     userId: user._id,
 *     data: { name: "Alice Smith", image: "https://example.com/avatar.png" },
 *   },
 * );
 * ```
 */
export const userPatch = mutation({
  args: { userId: v.id("User"), data: v.any() },
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
 * @example
 * ```ts
 * await ctx.runMutation(
 *   component.identity.users.userDelete,
 *   { userId: user._id },
 * );
 * ```
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
      const [sessions, accounts, keys, members, passkeys, totps] = await Promise.all([
        ctx.db
          .query("Session")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("Account")
          .withIndex("user_id_provider", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("ApiKey")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("GroupMember")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("Passkey")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("TotpFactor")
          .withIndex("user_id", (q) => q.eq("userId", userId))
          .collect(),
      ]);
      const refreshTokens =
        sessions.length > 0
          ? (
              await Promise.all(
                sessions.map((s) =>
                  ctx.db
                    .query("RefreshToken")
                    .withIndex("session_id", (q) => q.eq("sessionId", s._id))
                    .collect(),
                ),
              )
            ).flat()
          : [];
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
    await ctx.db.delete("User", userId);
    return null;
  },
});

// ============================================================================
// Accounts
// ============================================================================
