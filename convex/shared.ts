import { v } from "convex/values";

import { auth } from "./auth";
import { roles } from "./roles";

export const userSummary = v.object({
  userId: v.string(),
  name: v.string(),
  email: v.union(v.string(), v.null()),
});

export const groupSummary = v.object({
  groupId: v.string(),
  name: v.string(),
  roleIds: v.array(v.string()),
  grants: v.array(v.string()),
});

export const projectSummary = v.object({
  projectId: v.id("projects"),
  name: v.string(),
  identifier: v.string(),
  slug: v.string(),
  description: v.string(),
  status: v.string(),
  teamGroupId: v.union(v.string(), v.null()),
  teamName: v.union(v.string(), v.null()),
  issueCount: v.number(),
  openIssueCount: v.number(),
});

export const teamSummary = v.object({
  groupId: v.string(),
  name: v.string(),
  type: v.string(),
  children: v.array(
    v.object({
      groupId: v.string(),
      name: v.string(),
      type: v.string(),
    }),
  ),
});

export const memberSummary = v.object({
  memberId: v.string(),
  userId: v.string(),
  name: v.string(),
  email: v.union(v.string(), v.null()),
  roleIds: v.array(v.string()),
  status: v.string(),
});

export const permissionsValidator = v.object({
  canReadProjects: v.boolean(),
  canCreateProjects: v.boolean(),
  canManageProjects: v.boolean(),
  canCreateIssues: v.boolean(),
  canEditIssues: v.boolean(),
  canMoveIssues: v.boolean(),
  canAssignIssues: v.boolean(),
  canDeleteIssues: v.boolean(),
  canCreateComments: v.boolean(),
  canDeleteComments: v.boolean(),
  canManageTeams: v.boolean(),
  canManageMembers: v.boolean(),
  canManageSso: v.boolean(),
  canManageScim: v.boolean(),
});

export const issueSummary = v.object({
  issueId: v.id("issues"),
  identifier: v.string(),
  number: v.number(),
  title: v.string(),
  description: v.string(),
  status: v.string(),
  priority: v.string(),
  labels: v.array(v.string()),
  assigneeName: v.union(v.string(), v.null()),
  assigneeUserId: v.union(v.string(), v.null()),
  createdByName: v.string(),
  createdByUserId: v.string(),
});

export const commentSummary = v.object({
  commentId: v.id("comments"),
  authorName: v.string(),
  authorUserId: v.string(),
  body: v.string(),
  createdAt: v.number(),
});

export const inviteSummary = v.object({
  inviteId: v.string(),
  email: v.union(v.string(), v.null()),
  roleIds: v.array(v.string()),
  createdAt: v.number(),
});

export type GroupSummary = {
  groupId: string;
  name: string;
  roleIds: string[];
  grants: string[];
};

export function toSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function getUserSummary(ctx: any, userId: string) {
  const user = await auth.user.get(ctx, userId);
  return {
    userId,
    name: user?.name ?? user?.email ?? "Unknown user",
    email: user?.email ?? null,
  };
}

export function getPermissions(grants: string[]) {
  return {
    canReadProjects: grants.includes("projects.read"),
    canCreateProjects: grants.includes("projects.create"),
    canManageProjects: grants.includes("projects.manage"),
    canCreateIssues: grants.includes("issues.create"),
    canEditIssues: grants.includes("issues.edit"),
    canMoveIssues: grants.includes("issues.move"),
    canAssignIssues: grants.includes("issues.assign"),
    canDeleteIssues: grants.includes("issues.delete"),
    canCreateComments: grants.includes("comments.create"),
    canDeleteComments: grants.includes("comments.delete"),
    canManageTeams: grants.includes("teams.manage"),
    canManageMembers: grants.includes("members.manage"),
    canManageSso: grants.includes("sso.connection.manage"),
    canManageScim: grants.includes("scim.manage"),
  };
}

export function getUserRoleLabel(roleIds: string[]) {
  if (roleIds.includes(roles.orgAdmin.id)) {
    return "Admin";
  }
  if (roleIds.includes(roles.member.id)) {
    return "Member";
  }
  return "Viewer";
}

export const validRoleIds = [
  roles.orgAdmin.id,
  roles.member.id,
  roles.viewer.id,
] as const;
