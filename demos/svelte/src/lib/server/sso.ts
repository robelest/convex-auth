import { redirect } from "@sveltejs/kit";

import { api } from "$convex/_generated/api.js";

import { getConvexClient } from "./convex";

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

  if (!demo.selectedGroup) {
    const fallbackGroupId = demo.groups[0]?.groupId ?? null;
    throw redirect(302, fallbackGroupId ? `/${fallbackGroupId}` : "/");
  }

  if (demo.selectedGroup.groupId !== opts.groupId) {
    throw redirect(302, `/${demo.selectedGroup.groupId}`);
  }

  if (!demo.selectedGroup.permissions.canManageSso) {
    throw redirect(302, `/${opts.groupId}`);
  }

  return demo.selectedGroup;
}
