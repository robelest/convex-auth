/**
 * `component.factor.device.*` — OAuth 2.0 Device Authorization Grant
 * records (RFC 8628).
 *
 * Reads collapse into one overloaded `get`;
 * `authorize` is a kept domain verb (approval workflow).
 *
 * @module
 */

import { v } from "convex/values";

import { mutation, query } from "../functions";
import { vDeviceCodeDoc, vDeviceStatus } from "../model";

/**
 * Read a device-code record by `id`, by `deviceCodeHash`, or by `userCode`
 * (the last matches only a still-`pending` record).
 */
export const get = query({
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
        .withIndex("device_code_hash", (q) => q.eq("deviceCodeHash", args.deviceCodeHash!))
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

/** Insert a new device-code record. */
export const create = mutation({
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
 * Approve a device code, flipping its status to `authorized` and binding the
 * approving `userId`/`sessionId` so the polling device can exchange it for a
 * token.
 */
export const authorize = mutation({
  args: {
    id: v.id("DeviceCode"),
    userId: v.id("User"),
    sessionId: v.id("Session"),
  },
  returns: v.null(),
  handler: async (ctx, { id: deviceId, userId, sessionId }) => {
    await ctx.db.patch("DeviceCode", deviceId, {
      status: "authorized",
      userId,
      sessionId,
    });
    return null;
  },
});

/** Patch fields on a device-code record (e.g. status or `lastPolledAt`). */
export const update = mutation({
  args: {
    id: v.id("DeviceCode"),
    patch: v.object({
      status: v.optional(vDeviceStatus),
      userId: v.optional(v.id("User")),
      sessionId: v.optional(v.id("Session")),
      lastPolledAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: deviceId, patch }) => {
    await ctx.db.patch("DeviceCode", deviceId, patch);
    return null;
  },
});

/** Delete a device-code record. */
const remove = mutation({
  args: { id: v.id("DeviceCode") },
  returns: v.null(),
  handler: async (ctx, { id: deviceId }) => {
    await ctx.db.delete("DeviceCode", deviceId);
    return null;
  },
});

export { remove };
