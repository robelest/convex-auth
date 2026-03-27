<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import type { Id } from "convex/values";
  import { api } from "$convex/_generated/api.js";
  import { useQuery } from "convex-svelte";
  import IssueDetailPanel from "./IssueDetailPanel.svelte";

  let { project, permissions, members, currentUserId, workspaceGroupId, client } = $props<{
    project: {
      projectId: Id<"demoProjects">;
      name: string;
      identifier: string;
      slug: string;
      teamGroupId: string;
      teamName: string;
      description: string;
    };
    permissions: {
      canCreateIssues: boolean;
      canMoveIssues: boolean;
      canEditIssues: boolean;
      canAssignIssues: boolean;
      canDeleteIssues: boolean;
      canCreateComments: boolean;
      canDeleteComments: boolean;
    };
    members: Array<{ userId: string; name: string }>;
    currentUserId: string;
    workspaceGroupId: string;
    client: ConvexClient;
  }>();

  const issuesQuery = useQuery(
    api.demo.projectIssues,
    () => ({
      projectId: project.projectId,
    }),
  );

  const issues = $derived(issuesQuery.data?.issues ?? []);

  // Status ordering and labels
  const statusOrder = ["in_progress", "todo", "backlog", "done", "cancelled"] as const;

  const statusLabels: Record<string, string> = {
    backlog: "Backlog",
    todo: "Todo",
    in_progress: "In progress",
    done: "Done",
    cancelled: "Cancelled",
  };

  const statusColors: Record<string, string> = {
    backlog: "text-gray-400",
    todo: "text-gray-600",
    in_progress: "text-accent-500",
    done: "text-green-600",
    cancelled: "text-gray-300",
  };

  // Priority sort weight (lower = higher priority = sorted first)
  const priorityWeight: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
    none: 4,
  };

  const priorityLabels: Record<string, string> = {
    urgent: "Urgent",
    high: "High",
    medium: "Med",
    low: "Low",
    none: "",
  };

  // Group by status, sort by priority within each group
  type IssueType = (typeof issues)[number];
  type StatusGroup = { status: string; label: string; issues: IssueType[] };

  const groupedIssues = $derived.by(() => {
    const groups: StatusGroup[] = [];
    for (const status of statusOrder) {
      const grouped = issues
        .filter((i) => i.status === status)
        .sort((a, b) => (priorityWeight[a.priority] ?? 4) - (priorityWeight[b.priority] ?? 4));
      if (grouped.length > 0) {
        groups.push({ status, label: statusLabels[status], issues: grouped });
      }
    }
    return groups;
  });

  let expandedIssueId = $state<string | null>(null);
  let isCreating = $state(false);
  let newTitle = $state("");
  let errorMessage = $state<string | null>(null);

  function toggleIssue(issueId: string) {
    expandedIssueId = expandedIssueId === issueId ? null : issueId;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      expandedIssueId = null;
    }
  }

  async function handleCreateIssue() {
    if (newTitle.trim().length === 0) return;
    isCreating = true;
    errorMessage = null;
    try {
      const result = await client.mutation(api.demo.createIssue, {
        projectId: project.projectId,
        title: newTitle,
      });
      if ("ok" in result && !result.ok && "message" in result) {
        errorMessage = result.message ?? "Failed to create issue";
      } else {
        newTitle = "";
      }
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to create issue";
    } finally {
      isCreating = false;
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-3">
  <!-- Header -->
  <div class="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch flex-wrap">
    <div class="flex flex-col">
      <h2 class="section-header" style="border:0;margin:0;padding:0">
        <span class="text-gray-400">{project.identifier}</span>
        <span class="ml-1">{project.name}</span>
      </h2>
    </div>
    {#if permissions.canCreateIssues}
      <form class="flex gap-1.5 items-center" onsubmit={(e) => { e.preventDefault(); handleCreateIssue(); }}>
        <input
          bind:value={newTitle}
          class="input input--compact flex-1"
          maxlength="120"
          placeholder="New issue title"
          type="text"
        />
        <button
          class="button button--accent button--compact"
          disabled={isCreating || newTitle.trim().length === 0}
          type="submit"
        >
          {isCreating ? "Adding..." : "Add"}
        </button>
      </form>
    {/if}
  </div>

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}

  <!-- Issue list grouped by status -->
  {#if issues.length === 0}
    <p class="muted">No issues yet.</p>
  {:else}
    <div class="flex flex-col border border-gray-300 bg-white">
      {#each groupedIssues as group (group.status)}
        <!-- Status group header -->
        <div class="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-gray-200">
          <span class="inline-block w-2 h-2 rounded-full {statusColors[group.status]} {group.status === 'done' ? 'bg-green-600' : group.status === 'in_progress' ? 'bg-accent-500/50' : group.status === 'cancelled' ? 'bg-gray-300' : 'bg-current'}"></span>
          <span class="font-label text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-gray-500">{group.label}</span>
          <span class="font-label text-[0.6rem] text-gray-400">{group.issues.length}</span>
        </div>

        {#each group.issues as issue (issue.issueId)}
          <!-- Issue row -->
          <div
            class="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-transparent cursor-pointer hover:bg-gray-50 text-left w-full transition-colors duration-75 {expandedIssueId === issue.issueId ? 'bg-gray-100' : ''}"
            onclick={() => toggleIssue(issue.issueId)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIssue(issue.issueId); } }}
            role="button"
            tabindex="0"
          >
            <!-- Identifier -->
            <span class="font-label text-[0.6875rem] font-semibold text-gray-400 shrink-0 w-16">{issue.identifier}</span>

            <!-- Title -->
            <span class="font-sans text-[0.8125rem] font-medium text-gray-900 flex-1 truncate">{issue.title}</span>

            <!-- Priority -->
            {#if issue.priority !== "none"}
              <span class={`chip chip--${issue.priority === "urgent" ? "high" : issue.priority} shrink-0`}>{priorityLabels[issue.priority]}</span>
            {/if}

            <!-- Labels -->
            {#each issue.labels.slice(0, 2) as label}
              <span class="chip chip--grant shrink-0">{label}</span>
            {/each}

            <!-- Assignee -->
            <span class="font-label text-[0.6875rem] text-gray-500 shrink-0 w-20 text-right truncate">
              {issue.assigneeName ?? "—"}
            </span>
          </div>

          <!-- Inline expand -->
          {#if expandedIssueId === issue.issueId}
            <div class="border-b border-gray-300 bg-gray-50">
              <IssueDetailPanel
                {issue}
                {permissions}
                {members}
                {currentUserId}
                {workspaceGroupId}
                {client}
                onclose={() => { expandedIssueId = null; }}
              />
            </div>
          {/if}
        {/each}
      {/each}
    </div>
  {/if}
</div>
