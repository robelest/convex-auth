import {
  DataModelFromSchemaDefinition,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  TableNamesInDataModel,
  defineSchema,
  defineTable,
} from "convex/server";
import { GenericId, v } from "convex/values";
import { GenericDoc } from "../convex_types.js";

/**
 * The table definitions required by the library.
 *
 * Your schema must include these so that the indexes
 * are set up:
 *
 *
 * ```ts filename="convex/schema.ts"
 * import { defineSchema } from "convex/server";
 * import { authTables } from "@convex-dev/auth/component";
 *
 * const schema = defineSchema({
 *   ...authTables,
 * });
 *
 * export default schema;
 * ```
 *
 * You can inline the table definitions into your schema
 * and extend them with additional optional and required
 * fields. See https://labs.convex.dev/auth/setup/schema
 * for more details.
 */
export const authTables = {
  /**
   * Users.
   */
  user: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  /**
   * Sessions.
   * A single user can have multiple active sessions.
   * See [Session document lifecycle](https://labs.convex.dev/auth/advanced#session-document-lifecycle).
   */
  session: defineTable({
    userId: v.id("user"),
    expirationTime: v.number(),
  }).index("userId", ["userId"]),
  /**
   * Accounts. An account corresponds to
   * a single authentication provider.
   * A single user can have multiple accounts linked.
   */
  account: defineTable({
    userId: v.id("user"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index("userIdAndProvider", ["userId", "provider"])
    .index("providerAndAccountId", ["provider", "providerAccountId"]),
  /**
   * Refresh tokens.
   * Refresh tokens are generally meant to be used once, to be exchanged for another
   * refresh token and a JWT access token, but with a few exceptions:
   * - The "active refresh token" is the most recently created refresh token that has
   *   not been used yet. The parent of the active refresh token can always be used to
   *   obtain the active refresh token.
   * - A refresh token can be used within a 10 second window ("reuse window") to
   *   obtain a new refresh token.
   * - On any invalid use of a refresh token, the token itself and all its descendants
   *   are invalidated.
   */
  token: defineTable({
    sessionId: v.id("session"),
    expirationTime: v.number(),
    firstUsedTime: v.optional(v.number()),
    // This is the ID of the refresh token that was exchanged to create this one.
    parentRefreshTokenId: v.optional(v.id("token")),
  })
    // Sort by creationTime
    .index("sessionId", ["sessionId"])
    .index("sessionIdAndParentRefreshTokenId", [
      "sessionId",
      "parentRefreshTokenId",
    ]),
  /**
   * Verification codes:
   * - OTP tokens
   * - magic link tokens
   * - OAuth codes
   */
  verification: defineTable({
    accountId: v.id("account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index("accountId", ["accountId"])
    .index("code", ["code"]),
  /**
   * PKCE verifiers for OAuth.
   */
  verifier: defineTable({
    sessionId: v.optional(v.id("session")),
    signature: v.optional(v.string()),
  }).index("signature", ["signature"]),
  /**
   * Rate limits for OTP and password sign-in.
   */
  limit: defineTable({
    identifier: v.string(),
    lastAttemptTime: v.number(),
    attemptsLeft: v.number(),
  }).index("identifier", ["identifier"]),

  organization: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    ownerUserId: v.optional(v.id("user")),
    parentOrganizationId: v.optional(v.id("organization")),
    metadata: v.optional(v.any()),
  })
    .index("slug", ["slug"])
    .index("ownerUserId", ["ownerUserId"])
    .index("parentOrganizationId", ["parentOrganizationId"]),
  team: defineTable({
    organizationId: v.id("organization"),
    name: v.string(),
    slug: v.optional(v.string()),
    parentTeamId: v.optional(v.id("team")),
    metadata: v.optional(v.any()),
  })
    .index("organizationId", ["organizationId"])
    .index("organizationIdAndSlug", ["organizationId", "slug"])
    .index("parentTeamId", ["parentTeamId"]),
  teamRelation: defineTable({
    organizationId: v.id("organization"),
    parentTeamId: v.id("team"),
    childTeamId: v.id("team"),
    relation: v.optional(v.string()),
  })
    .index("organizationId", ["organizationId"])
    .index("organizationIdAndParentTeamId", ["organizationId", "parentTeamId"])
    .index("organizationIdAndChildTeamId", ["organizationId", "childTeamId"]),
  member: defineTable({
    organizationId: v.id("organization"),
    userId: v.id("user"),
    teamId: v.optional(v.id("team")),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("organizationId", ["organizationId"])
    .index("organizationIdAndUserId", ["organizationId", "userId"])
    .index("teamId", ["teamId"])
    .index("userId", ["userId"]),
  invite: defineTable({
    organizationId: v.optional(v.id("organization")),
    teamId: v.optional(v.id("team")),
    invitedByUserId: v.id("user"),
    email: v.string(),
    tokenHash: v.string(),
    role: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresTime: v.number(),
    acceptedByUserId: v.optional(v.id("user")),
    acceptedTime: v.optional(v.number()),
    metadata: v.optional(v.any()),
  })
    .index("tokenHash", ["tokenHash"])
    .index("emailAndStatus", ["email", "status"])
    .index("invitedByUserIdAndStatus", ["invitedByUserId", "status"])
    .index("organizationId", ["organizationId"])
    .index("organizationIdAndStatus", ["organizationId", "status"]),
};

const defaultSchema = defineSchema(authTables);

export type AuthDataModel = DataModelFromSchemaDefinition<typeof defaultSchema>;
export type ActionCtx = GenericActionCtx<AuthDataModel>;
export type MutationCtx = GenericMutationCtx<AuthDataModel>;
export type QueryCtx = GenericQueryCtx<AuthDataModel>;
export type Doc<T extends TableNamesInDataModel<AuthDataModel>> = GenericDoc<
  AuthDataModel,
  T
>;

export type Tokens = { token: string; refreshToken: string };
export type SessionInfo = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
  tokens: Tokens | null;
};
export type SessionInfoWithTokens = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
  tokens: Tokens;
};
