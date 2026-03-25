import { defineRoles } from "@robelest/convex-auth/authorization";

export const roles = defineRoles({
  orgAdmin: {
    label: "Admin",
    grants: [
      "projects.read",
      "projects.create",
      "projects.manage",
      "issues.create",
      "issues.edit",
      "issues.move",
      "issues.assign",
      "issues.delete",
      "comments.create",
      "comments.delete",
      "members.manage",
      "members.read",
      "teams.manage",
      "workspace.settings",
      "sso.connection.create",
      "sso.connection.read",
      "sso.connection.manage",
      "sso.domain.manage",
      "sso.protocol.manage",
      "sso.policy.manage",
      "sso.audit.read",
      "sso.webhook.manage",
      "scim.manage",
    ],
  },
  member: {
    label: "Member",
    grants: [
      "projects.read",
      "issues.create",
      "issues.edit",
      "issues.move",
      "comments.create",
      "members.read",
    ],
  },
  viewer: {
    label: "Viewer",
    grants: ["projects.read", "members.read"],
  },
});
