import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useQuery } from "convex/react";
import React from "react";

export interface GroupProject {
  _id: Id<"projects">;
  groupId: string;
  name: string;
  identifier: string;
  slug: string;
  description: string;
  status: string;
  openIssueCount: number;
  issueCounter: number;
}

export function useGroupData() {
  const dashboard = useQuery(api.groups.get, {});
  const group = React.useMemo(
    () => (dashboard ? { selectedGroup: dashboard.selectedGroup ?? null } : undefined),
    [dashboard],
  );
  const groupId = group?.selectedGroup?.groupId;

  const groupProjects = React.useMemo(() => {
    return (group?.selectedGroup?.projects ?? []).map((project) => ({
      _id: project.projectId,
      groupId: groupId!,
      name: project.name,
      identifier: project.identifier,
      slug: project.slug,
      description: project.description,
      status: project.status,
      openIssueCount: project.openIssueCount,
      issueCounter: project.issueCount,
    }));
  }, [group?.selectedGroup?.projects, groupId]);

  return {
    group,
    groupId,
    projects: groupProjects,
  };
}
