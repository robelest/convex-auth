import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vDeviceCodeDoc, vDeviceStatus } from "../../model";

/**
 * Insert a new device authorization record into the `DeviceCode` table.
 *
 * Creates a pending device authorization entry as part of the OAuth 2.0
 * Device Authorization Grant (RFC 8628). The record tracks the hashed device
 * code, the human-readable user code, expiry, and polling interval.
 *
 * @param deviceCodeHash - SHA-256 hash of the device code issued to the client.
 *   Only the hash is stored; the raw code is never persisted.
 * @param userCode - Short, human-readable code displayed to the end-user
 *   so they can authorize the device on a separate screen.
 * @param expiresAt - Unix timestamp (in milliseconds) after which the device
 *   authorization request is no longer valid.
 * @param interval - Minimum polling interval in seconds that the device client
 *   must wait between token requests.
 * @param status - Initial status of the device authorization (e.g. `"pending"`).
 * @returns The `_id` of the newly created `DeviceCode` document.
 *
 */
export const deviceInsert = mutation({
  args: {
    deviceCodeHash: v.string(),
    userCode: v.string(),
    expiresAt: v.number(),
    interval: v.number(),
    status: vDeviceStatus,
  },
  returns: v.id("DeviceCode"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("DeviceCode", args);
  },
});

/**
 * Read a device authorization record by identity.
 *
 * Accepts exactly one selector:
 * - `id` — direct document lookup by `DeviceCode` `_id`.
 * - `deviceCodeHash` — lookup via the `device_code_hash` index. This is
 *   the primary lookup used by the token endpoint when a device client
 *   polls for authorization status.
 * - `userCode` — the first `"pending"` record matching the user-facing
 *   code, via the `user_code_status` compound index. Used when an
 *   authenticated user enters the code shown on the device to approve it.
 *
 * @param id - Optional `_id` of the `DeviceCode` document to retrieve.
 * @param deviceCodeHash - Optional SHA-256 hash of the device code.
 * @param userCode - Optional short, human-readable code the user typed
 *   in (e.g. `"ABCD-1234"`).
 * @returns The matching `DeviceCode` document, or `null` if none matches.
 *
 */
export const deviceGet = query({
  args: {
    id: v.optional(v.id("DeviceCode")),
    deviceCodeHash: v.optional(v.string()),
    userCode: v.optional(v.string()),
  },
  returns: v.union(vDeviceCodeDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.deviceCodeHash !== undefined) {
      return await ctx.db
        .query("DeviceCode")
        .withIndex("device_code_hash", (q) =>
          q.eq("deviceCodeHash", args.deviceCodeHash!),
        )
        .first();
    }
    if (args.userCode !== undefined) {
      return await ctx.db
        .query("DeviceCode")
        .withIndex("user_code_status", (q) =>
          q.eq("userCode", args.userCode!).eq("status", "pending"),
        )
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("DeviceCode", args.id);
  },
});

/**
 * Authorize a device code by linking it to a user and session.
 *
 * Transitions the device authorization status from `"pending"` to
 * `"authorized"` and associates it with the approving user and their
 * active session. After this mutation, the next poll from the device
 * client will succeed and tokens can be issued.
 *
 * @param deviceId - The `_id` of the `DeviceCode` document to authorize.
 * @param userId - The `_id` of the `User` who approved the device request.
 * @param sessionId - The `_id` of the `Session` associated with the
 *   approving user's current login.
 * @returns `null` on success.
 *
 */
export const deviceAuthorize = mutation({
  args: {
    deviceId: v.id("DeviceCode"),
    userId: v.id("User"),
    sessionId: v.id("Session"),
  },
  returns: v.null(),
  handler: async (ctx, { deviceId, userId, sessionId }) => {
    await ctx.db.patch("DeviceCode", deviceId, {
      status: "authorized",
      userId,
      sessionId,
    });
    return null;
  },
});

/**
 * Partially update a device authorization record.
 *
 * Performs a partial patch on the `DeviceCode` document — e.g. bumping
 * `lastPolledAt` on each poll to enforce the minimum polling interval
 * and detect slow-polling violations per RFC 8628.
 *
 * @param deviceId - The `_id` of the `DeviceCode` document to update.
 * @param data - An object containing the fields to patch.
 * @returns `null` on success.
 *
 */
export const deviceUpdate = mutation({
  args: {
    deviceId: v.id("DeviceCode"),
    data: v.object({
      status: v.optional(vDeviceStatus),
      userId: v.optional(v.id("User")),
      sessionId: v.optional(v.id("Session")),
      lastPolledAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { deviceId, data }) => {
    await ctx.db.patch("DeviceCode", deviceId, data);
    return null;
  },
});

/**
 * Delete a device authorization record from the `DeviceCode` table.
 *
 * Permanently removes the device code entry. This should be called after
 * the device authorization has been successfully exchanged for tokens, or
 * when the authorization has expired and needs to be cleaned up.
 *
 * @param deviceId - The `_id` of the `DeviceCode` document to delete.
 * @returns `null` on success.
 *
 */
export const deviceDelete = mutation({
  args: { deviceId: v.id("DeviceCode") },
  returns: v.null(),
  handler: async (ctx, { deviceId }) => {
    await ctx.db.delete("DeviceCode", deviceId);
    return null;
  },
});
