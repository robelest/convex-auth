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
 * @example
 * ```ts
 * const deviceCodeId = await ctx.runMutation(
 *   components.auth.factors.devices.deviceInsert,
 *   {
 *     deviceCodeHash: "a1b2c3d4e5f6...",
 *     userCode: "ABCD-1234",
 *     expiresAt: Date.now() + 10 * 60 * 1000,
 *     interval: 5,
 *     status: "pending",
 *   },
 * );
 * ```
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
 * Look up a device authorization record by its hashed device code.
 *
 * Queries the `DeviceCode` table using the `device_code_hash` index.
 * This is the primary lookup used by the token endpoint when a device
 * client polls for authorization status.
 *
 * @param deviceCodeHash - SHA-256 hash of the device code to look up.
 * @returns The matching `DeviceCode` document, or `null` if no record
 *   exists for the given hash.
 *
 * @example
 * ```ts
 * const deviceCode = await ctx.runQuery(
 *   components.auth.factors.devices.deviceGetByCodeHash,
 *   { deviceCodeHash: "a1b2c3d4e5f6..." },
 * );
 * if (deviceCode && deviceCode.status === "authorized") {
 *   // Exchange for tokens
 * }
 * ```
 */
export const deviceGetByCodeHash = query({
  args: { deviceCodeHash: v.string() },
  returns: v.union(vDeviceCodeDoc, v.null()),
  handler: async (ctx, { deviceCodeHash }) => {
    return await ctx.db
      .query("DeviceCode")
      .withIndex("device_code_hash", (q) =>
        q.eq("deviceCodeHash", deviceCodeHash),
      )
      .first();
  },
});

/**
 * Look up a pending device authorization by its user-facing code.
 *
 * Queries the `DeviceCode` table using the `user_code_status` compound index,
 * filtering to only `"pending"` records. This is called when an authenticated
 * user enters the code shown on the device to approve the authorization.
 *
 * @param userCode - The short, human-readable code the user typed in
 *   (e.g. `"ABCD-1234"`).
 * @returns The matching pending `DeviceCode` document, or `null` if no
 *   pending authorization exists for the given user code.
 *
 * @example
 * ```ts
 * const pending = await ctx.runQuery(
 *   components.auth.factors.devices.deviceGetByUserCode,
 *   { userCode: "ABCD-1234" },
 * );
 * if (pending === null) {
 *   throw new Error("Invalid or expired user code");
 * }
 * ```
 */
export const deviceGetByUserCode = query({
  args: { userCode: v.string() },
  returns: v.union(vDeviceCodeDoc, v.null()),
  handler: async (ctx, { userCode }) => {
    return await ctx.db
      .query("DeviceCode")
      .withIndex("user_code_status", (q) =>
        q.eq("userCode", userCode).eq("status", "pending"),
      )
      .first();
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
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.factors.devices.deviceAuthorize,
 *   {
 *     deviceId: pending._id,
 *     userId: currentUser._id,
 *     sessionId: currentSession._id,
 *   },
 * );
 * ```
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
 * Update the last-polled timestamp on a device authorization record.
 *
 * Called each time the device client polls the token endpoint. The
 * timestamp is used to enforce the minimum polling interval and to
 * detect slow-polling violations per RFC 8628.
 *
 * @param deviceId - The `_id` of the `DeviceCode` document to update.
 * @param lastPolledAt - Unix timestamp (in milliseconds) of the most
 *   recent poll request from the device client.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.factors.devices.deviceUpdateLastPolled,
 *   {
 *     deviceId: deviceCode._id,
 *     lastPolledAt: Date.now(),
 *   },
 * );
 * ```
 */
export const deviceUpdateLastPolled = mutation({
  args: { deviceId: v.id("DeviceCode"), lastPolledAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { deviceId, lastPolledAt }) => {
    await ctx.db.patch("DeviceCode", deviceId, { lastPolledAt });
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
 * @example
 * ```ts
 * // Clean up after successful token exchange
 * await ctx.runMutation(
 *   components.auth.factors.devices.deviceDelete,
 *   { deviceId: deviceCode._id },
 * );
 * ```
 */
export const deviceDelete = mutation({
  args: { deviceId: v.id("DeviceCode") },
  returns: v.null(),
  handler: async (ctx, { deviceId }) => {
    await ctx.db.delete("DeviceCode", deviceId);
    return null;
  },
});
