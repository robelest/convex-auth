import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    userId: v.string(),
    body: v.string(),
    groupId: v.optional(v.string()),
  }),
});
