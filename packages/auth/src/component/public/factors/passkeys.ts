import { v } from "convex/values";
import { mutation, query } from "../../functions";
import { vPasskeyDoc } from "../../model";

/**
 * Store a new WebAuthn passkey credential for a user.
 *
 * Persists the public key material and metadata returned by the browser's
 * `navigator.credentials.create()` call after a successful registration
 * ceremony. Each passkey is tied to a single user.
 *
 * @param userId - The `_id` of the `User` who owns this passkey.
 * @param credentialId - Base64url-encoded credential identifier assigned
 *   by the authenticator; used to look up the key during authentication.
 * @param publicKey - Raw public key bytes (COSE format) for signature
 *   verification.
 * @param algorithm - COSE algorithm identifier (e.g. `-7` for ES256,
 *   `-257` for RS256).
 * @param counter - Signature counter reported by the authenticator at
 *   registration time; used to detect cloned credentials.
 * @param transports - Optional list of transport hints (e.g.
 *   `["usb", "ble", "nfc", "internal"]`) to help the browser select
 *   the correct authenticator.
 * @param deviceType - Authenticator attachment type (e.g.
 *   `"singleDevice"` or `"multiDevice"`).
 * @param backedUp - Whether the credential is backed up (synced) by the
 *   authenticator platform.
 * @param name - Optional human-readable label for the passkey
 *   (e.g. `"MacBook Pro Touch ID"`).
 * @param createdAt - Unix timestamp (in milliseconds) when the passkey
 *   was registered.
 * @returns The `_id` of the newly created `Passkey` document.
 *
 * @example
 * ```ts
 * const passkeyId = await ctx.runMutation(
 *   components.auth.factors.passkeys.passkeyInsert,
 *   {
 *     userId: user._id,
 *     credentialId: "dGVzdC1jcmVkZW50aWFs",
 *     publicKey: publicKeyBytes,
 *     algorithm: -7,
 *     counter: 0,
 *     transports: ["internal"],
 *     deviceType: "multiDevice",
 *     backedUp: true,
 *     name: "MacBook Pro Touch ID",
 *     createdAt: Date.now(),
 *   },
 * );
 * ```
 */
export const passkeyInsert = mutation({
  args: {
    userId: v.id("User"),
    credentialId: v.string(),
    publicKey: v.bytes(),
    algorithm: v.number(),
    counter: v.number(),
    transports: v.optional(v.array(v.string())),
    deviceType: v.string(),
    backedUp: v.boolean(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("Passkey"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("Passkey", args);
  },
});

/**
 * Look up a passkey by its credential ID.
 *
 * Queries the `Passkey` table using the `credential_id` unique index.
 * This is the primary lookup during a WebAuthn authentication ceremony:
 * the authenticator provides a credential ID, and this function retrieves
 * the corresponding public key and counter for signature verification.
 *
 * @param credentialId - Base64url-encoded credential identifier to search for.
 * @returns The matching `Passkey` document, or `null` if no passkey exists
 *   with the given credential ID.
 *
 * @example
 * ```ts
 * const passkey = await ctx.runQuery(
 *   components.auth.factors.passkeys.passkeyGetByCredentialId,
 *   { credentialId: "dGVzdC1jcmVkZW50aWFs" },
 * );
 * if (passkey === null) {
 *   throw new Error("Unknown credential");
 * }
 * ```
 */
export const passkeyGetByCredentialId = query({
  args: { credentialId: v.string() },
  returns: v.union(vPasskeyDoc, v.null()),
  handler: async (ctx, { credentialId }) => {
    return await ctx.db
      .query("Passkey")
      .withIndex("credential_id", (q) => q.eq("credentialId", credentialId))
      .unique();
  },
});

/**
 * List all passkeys registered to a user.
 *
 * Retrieves every `Passkey` document associated with the given user via
 * the `user_id` index. Useful for displaying a user's registered
 * authenticators in a settings page, or for building the
 * `allowCredentials` list during a WebAuthn authentication ceremony.
 *
 * @param userId - The `_id` of the `User` whose passkeys to retrieve.
 * @returns An array of `Passkey` documents. Returns an empty array if the
 *   user has no registered passkeys.
 *
 * @example
 * ```ts
 * const passkeys = await ctx.runQuery(
 *   components.auth.factors.passkeys.passkeyListByUserId,
 *   { userId: user._id },
 * );
 * // Display each passkey's name and creation date
 * for (const pk of passkeys) {
 *   console.log(pk.name, new Date(pk.createdAt));
 * }
 * ```
 */
export const passkeyListByUserId = query({
  args: { userId: v.id("User") },
  returns: v.array(vPasskeyDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Passkey")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Update a passkey's signature counter and last-used timestamp after
 * a successful authentication.
 *
 * After verifying a WebAuthn assertion, the relying party must persist
 * the new counter value reported by the authenticator. A counter that
 * does not increase may indicate a cloned credential.
 *
 * @param passkeyId - The `_id` of the `Passkey` document to update.
 * @param counter - The new signature counter value returned by the
 *   authenticator in the assertion response.
 * @param lastUsedAt - Unix timestamp (in milliseconds) recording when
 *   this passkey was most recently used to authenticate.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.factors.passkeys.passkeyUpdateCounter,
 *   {
 *     passkeyId: passkey._id,
 *     counter: assertionResponse.counter,
 *     lastUsedAt: Date.now(),
 *   },
 * );
 * ```
 */
export const passkeyUpdateCounter = mutation({
  args: {
    passkeyId: v.id("Passkey"),
    counter: v.number(),
    lastUsedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { passkeyId, counter, lastUsedAt }) => {
    await ctx.db.patch("Passkey", passkeyId, { counter, lastUsedAt });
    return null;
  },
});

/**
 * Update a passkey's metadata fields.
 *
 * Performs a partial patch on the `Passkey` document. Typically used to
 * rename a passkey (e.g. from `"Security Key"` to `"YubiKey 5C"`), but
 * can update any mutable fields via the `data` argument.
 *
 * @param passkeyId - The `_id` of the `Passkey` document to update.
 * @param data - An object containing the fields to patch. Commonly
 *   includes `{ name: "New Label" }`, but accepts any valid passkey fields.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.factors.passkeys.passkeyUpdateMeta,
 *   {
 *     passkeyId: passkey._id,
 *     data: { name: "YubiKey 5C NFC" },
 *   },
 * );
 * ```
 */
export const passkeyUpdateMeta = mutation({
  args: { passkeyId: v.id("Passkey"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { passkeyId, data }) => {
    await ctx.db.patch("Passkey", passkeyId, data);
    return null;
  },
});

/**
 * Delete a passkey credential from the `Passkey` table.
 *
 * Permanently removes the passkey record. After deletion the credential
 * can no longer be used for authentication. Typically called from a
 * user's security settings when they want to unregister an authenticator.
 *
 * @param passkeyId - The `_id` of the `Passkey` document to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.factors.passkeys.passkeyDelete,
 *   { passkeyId: passkey._id },
 * );
 * ```
 */
export const passkeyDelete = mutation({
  args: { passkeyId: v.id("Passkey") },
  returns: v.null(),
  handler: async (ctx, { passkeyId }) => {
    await ctx.db.delete("Passkey", passkeyId);
    return null;
  },
});

// ============================================================================
// TOTP Two-Factor Authentication
// ============================================================================
