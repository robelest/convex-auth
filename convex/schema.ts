import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const demoProjectStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

export const demoIssueStatus = v.union(
  v.literal("backlog"),
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("cancelled"),
);

export const demoIssuePriority = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("none"),
);

export default defineSchema({
  demoProjects: defineTable({
    groupId: v.string(),
    teamGroupId: v.optional(v.string()),
    name: v.string(),
    identifier: v.string(),
    slug: v.string(),
    description: v.string(),
    status: demoProjectStatus,
    createdByUserId: v.string(),
    issueCounter: v.number(),
    openIssueCount: v.optional(v.number()),
  })
    .index("by_groupId", ["groupId"])
    .index("by_teamGroupId", ["teamGroupId"])
    .index("by_groupId_and_slug", ["groupId", "slug"]),

  demoIssues: defineTable({
    projectId: v.id("demoProjects"),
    groupId: v.string(),
    scopeGroupId: v.string(),
    number: v.number(),
    title: v.string(),
    description: v.string(),
    status: demoIssueStatus,
    priority: demoIssuePriority,
    assigneeUserId: v.optional(v.string()),
    createdByUserId: v.string(),
    labels: v.optional(v.array(v.string())),
    position: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_groupId", ["groupId"])
    .index("by_assigneeUserId", ["assigneeUserId"]),

  demoComments: defineTable({
    issueId: v.id("demoIssues"),
    groupId: v.string(),
    authorUserId: v.string(),
    body: v.string(),
  }).index("by_issueId", ["issueId"]),
});
