/**
 * `component.user.*` — the User entity surface.
 *
 * Reads collapse into one overloaded `get`; the rest are 1:1 verbs.
 *
 * @module
 */

import { v } from "convex/values";

import { query } from "./functions";
import { vUserDoc } from "./model";

export {
  userList as list,
  userInsert as create,
  userUpsert as upsert,
  userPatch as update,
  userDelete as delete,
} from "./public/identity/users";

/**
 * Read a user by identity. One overloaded function (single Convex
 * function with a unioned `args`/`returns`). Accepts exactly one
 * selector:
 *
 * - `{ id }`           → `Doc<"User"> | null`
 * - `{ ids }`          → `(Doc<"User"> | null)[]` (order preserved, deduped)
 * - `{ verifiedEmail }`→ `Doc<"User"> | null` (exactly-one-or-null)
 * - `{ verifiedPhone }`→ `Doc<"User"> | null` (exactly-one-or-null)
 *
 * @example
 * ```ts
 * await ctx.runQuery(component.user.get, { id: userId });
 * await ctx.runQuery(component.user.get, { ids: memberIds });
 * await ctx.runQuery(component.user.get, { verifiedEmail: "a@b.com" });
 * ```
 */
export const get = query({
  args: {
    id: v.optional(v.id("User")),
    ids: v.optional(v.array(v.id("User"))),
    verifiedEmail: v.optional(v.string()),
    verifiedPhone: v.optional(v.string()),
  },
  returns: v.union(vUserDoc, v.null(), v.array(v.union(vUserDoc, v.null()))),
  handler: async (ctx, args) => {
    if (args.ids !== undefined) {
      if (args.ids.length === 0) return [];
      const unique = Array.from(new Set(args.ids));
      const docs = await Promise.all(unique.map((id) => ctx.db.get("User", id)));
      const byId = new Map(unique.map((id, i) => [id, docs[i] ?? null]));
      return args.ids.map((id) => byId.get(id) ?? null);
    }
    if (args.verifiedEmail !== undefined) {
      const users = await ctx.db
        .query("User")
        .withIndex("email_verified", (q) =>
          q.eq("email", args.verifiedEmail!).gt("emailVerificationTime", undefined),
        )
        .take(2);
      return users.length === 1 ? users[0] : null;
    }
    if (args.verifiedPhone !== undefined) {
      const users = await ctx.db
        .query("User")
        .withIndex("phone_verified", (q) =>
          q.eq("phone", args.verifiedPhone!).gt("phoneVerificationTime", undefined),
        )
        .take(2);
      return users.length === 1 ? users[0] : null;
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("User", args.id);
  },
});
