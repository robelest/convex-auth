import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const projectStatus = v.union(v.literal("active"), v.literal("archived"));

export const issueStatus = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("cancelled"),
);

export const issuePriority = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("none"),
);

export default defineSchema({
  projects: defineTable({
    groupId: v.string(),
    name: v.string(),
    identifier: v.string(),
    slug: v.string(),
    description: v.string(),
    status: projectStatus,
    createdByUserId: v.string(),
    issueCounter: v.number(),
    openIssueCount: v.optional(v.number()),
  })
    .index("by_groupId", ["groupId"])
    .index("by_groupId_and_slug", ["groupId", "slug"])
    .index("by_groupId_and_identifier", ["groupId", "identifier"]),

  issues: defineTable({
    projectId: v.id("projects"),
    groupId: v.string(),
    scopeGroupId: v.string(),
    number: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    status: issueStatus,
    priority: issuePriority,
    assigneeUserId: v.optional(v.string()),
    createdByUserId: v.string(),
    labels: v.optional(v.array(v.string())),
    position: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_groupId", ["groupId"])
    .index("by_assigneeUserId", ["assigneeUserId"]),

  comments: defineTable({
    issueId: v.id("issues"),
    groupId: v.string(),
    authorUserId: v.string(),
    body: v.string(),
  }).index("by_issueId", ["issueId"]),
});
