# Migrate Access Checks: Email -> User ID

This guide migrates privileged access checks from email-based checks to userId-based checks when using `@robelest/convex-auth`.

## Why migrate

- JWT identity is intentionally minimal (`subject = userId|sessionId`)
- email is mutable and may be missing depending on provider/account state
- userId is stable and should be your authorization key

## Target model

- **Input UX:** accept email in admin tooling
- **Storage ACL:** persist `userId` in your admin table
- **Runtime checks:** authorize by `userId`
- **Optional:** keep email as a snapshot for audit/display only

## Step 1: Add userId to your admin table

Example schema:

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  accessGrants: defineTable({
    userId: v.optional(v.id("user")),
    email: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"]),
});
```

## Step 2: Dual-read during rollout

Use userId first, then fallback to email for legacy rows.

```ts
// convex/access.ts
import { query } from "./_generated/server";
import { auth } from "./auth";

export const canAccessAdminTools = query({
  args: {},
  handler: async (ctx) => {
    const user = await auth.user.viewer(ctx);
    if (!user) return false;

    const byUserId = await ctx.db
      .query("accessGrants")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (byUserId) return true;

    const email = user.email?.trim().toLowerCase();
    if (!email) return false;

    const byEmail = await ctx.db
      .query("accessGrants")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    return byEmail !== null;
  },
});
```

## Step 3: Make grants userId-based

Admin grant mutations should accept `userId` and persist `userId`.

```ts
// convex/accessAdmin.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const grantAccess = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await ctx.db.insert("accessGrants", {
      userId,
      createdAt: Date.now(),
    });
  },
});
```

If your UI starts from an email field, resolve email to `userId` in your
application layer (for example via a user picker, profile directory, or a
pre-existing users table), then call this mutation.

## Step 4: Backfill existing rows without direct component calls

Use a lazy migration during sign-in. When a signed-in user matches a legacy
email-based admin row, patch that row with `userId`.

```ts
// convex/accessAdmin.ts
import { mutation } from "./_generated/server";
import { auth } from "./auth";

export const upgradeLegacyAccessGrant = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await auth.user.viewer(ctx);
    if (!user?.email) return false;

    const email = user.email.trim().toLowerCase();
    const legacy = await ctx.db
      .query("accessGrants")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (!legacy || legacy.userId) return false;

    await ctx.db.patch(legacy._id, { userId: user._id });
    return true;
  },
});
```

Call this mutation after successful sign-in (or on first protected dashboard
load) during the rollout window.

## Step 5: Remove fallback

After backfill + verification:

- remove email fallback from runtime admin checks
- keep only `by_userId` authorization
- optionally keep `email` column for display/history

## Notes

- Do not parse JWT `subject` manually unless you have to. Prefer `auth.user.require(ctx)` or `auth.user.viewer(ctx)`.
- `account` is many-to-one with `user`; authorization should follow user identity.
