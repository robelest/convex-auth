import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "../server/implementation/types.js";

const {
  user,
  account,
  session,
  token,
  verification,
  verifier,
  limit,
} = authTables;
void user;

export default defineSchema({
  user: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    favoriteColor: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  account,
  session,
  token,
  verification,
  verifier,
  limit,
});
