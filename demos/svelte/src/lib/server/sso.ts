import { redirect } from "@sveltejs/kit";
import type { GroupSummary } from "../../../../../convex/shared";

import { api } from "$convex/_generated/api.js";

import { getConvexClient } from "./convex";

type SelectedGroup = {
  groupId: string;
  permissions: { canManageSso: boolean };
};

export async function requireSsoManagerAccess(opts: {
  authToken: string | null;
  groupId: string;
}) {
  if (!opts.authToken) {
    throw redirect(302, "/");
  }

  const client = getConvexClient(opts.authToken);
  const demo = await client.query(api.groups.getDashboard, {
    groupId: opts.groupId,
  });
  const groups = demo.groups as GroupSummary[];
  const selectedGroup = demo.selectedGroup as SelectedGroup | null;

  if (!selectedGroup) {
    const fallbackGroupId = groups[0]?.groupId ?? null;
    throw redirect(302, fallbackGroupId ? `/${fallbackGroupId}` : "/");
  }

  if (selectedGroup.groupId !== opts.groupId) {
    throw redirect(302, `/${selectedGroup.groupId}`);
  }

  if (!selectedGroup.permissions.canManageSso) {
    throw redirect(302, `/${opts.groupId}`);
  }

  return selectedGroup;
}
