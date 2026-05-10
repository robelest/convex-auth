<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { useQuery } from "convex-svelte";
  import X from "phosphor-svelte/lib/X";
  import Trash from "phosphor-svelte/lib/Trash";

  let {
    issue,
    permissions,
    members,
    currentUserId,
    groupId,
    client,
    onclose,
  } = $props<{
    issue: {
      _id: string;
      identifier: string;
      number: number;
      title: string;
      description: string;
      status: string;
      priority: string;
      labels: string[];
      assigneeName: string | null;
      assigneeUserId: string | null;
      createdByName: string;
      createdByUserId: string;
    };
    permissions: {
      canEditIssues: boolean;
      canMoveIssues: boolean;
      canAssignIssues: boolean;
      canDeleteIssues: boolean;
      canCreateComments: boolean;
      canDeleteComments: boolean;
    };
    members: Array<{ userId: string; name: string }>;
    currentUserId: string;
    groupId: string;
    client: ConvexClient;
    onclose: () => void;
  }>();

  const commentsQuery = useQuery(
    api.comments.forIssue,
    () => ({
			issueId: issue._id,
    }),
  );

  const comments = $derived(commentsQuery.data ?? []);

  const isOwnerOrAssignee = $derived(
    issue.createdByUserId === currentUserId || issue.assigneeUserId === currentUserId,
  );
  const canEdit = $derived(
    permissions.canEditIssues && (permissions.canAssignIssues || isOwnerOrAssignee),
  );
  const canMove = $derived(permissions.canMoveIssues);
  const canAssign = $derived(permissions.canAssignIssues);
  const canDelete = $derived(permissions.canDeleteIssues);
  const canComment = $derived(permissions.canCreateComments);
  const canDeleteComments = $derived(permissions.canDeleteComments);

  const isViewer = $derived(!canEdit && !canMove && !canComment);

  let newComment = $state("");
  let isSubmittingComment = $state(false);
  let isEditing = $state(false);
  let editTitle = $state("");
  let editDescription = $state("");
  let errorMessage = $state<string | null>(null);

  type IssueStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";
  type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

  const statusOptions: Array<{ value: IssueStatus; label: string }> = [
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "Todo" },
    { value: "in_progress", label: "In progress" },
    { value: "done", label: "Done" },
    { value: "cancelled", label: "Cancelled" },
  ];

  const priorityOptions: Array<{ value: IssuePriority; label: string }> = [
    { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
    { value: "none", label: "None" },
  ];

  function startEditing() {
    if (!canEdit) return;
    editTitle = issue.title;
    editDescription = issue.description;
    isEditing = true;
  }

  async function saveEdit() {
    errorMessage = null;
    try {
      await client.mutation(api.issues.update, {
			issueId: issue._id,
        title: editTitle,
        description: editDescription,
      });
      isEditing = false;
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to save";
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!canMove) return;
    errorMessage = null;
    try {
      await client.mutation(api.issues.update, {
			issueId: issue._id,
        status: newStatus,
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to update status";
    }
  }

  async function handlePriorityChange(newPriority: string) {
    if (!canEdit) return;
    errorMessage = null;
    try {
      await client.mutation(api.issues.update, {
			issueId: issue._id,
        priority: newPriority,
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to update priority";
    }
  }

  async function handleAssigneeChange(newAssigneeUserId: string) {
    errorMessage = null;
    try {
      const result = await client.mutation(api.issues.update, {
			issueId: issue._id,
        assigneeUserId: newAssigneeUserId || null,
      });
      if ("ok" in result && !result.ok && "message" in result) {
        errorMessage = typeof result.message === "string" ? result.message : "Failed to assign";
      }
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to assign";
    }
  }

  async function handleAddComment() {
    if (newComment.trim().length === 0 || !canComment) return;
    isSubmittingComment = true;
    errorMessage = null;
    try {
      await client.mutation(api.comments.create, {
			issueId: issue._id,
        body: newComment,
      });
      newComment = "";
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to add comment";
    } finally {
      isSubmittingComment = false;
    }
  }

  async function handleDeleteComment(commentId: string) {
    errorMessage = null;
    try {
      await client.mutation(api.comments.remove, {
        commentId,
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to delete comment";
    }
  }

  let confirmingDelete = $state(false);

  async function handleDeleteIssue() {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }
    errorMessage = null;
    try {
      await client.mutation(api.issues.remove, {
        issueId: issue._id,
      });
      onclose();
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to delete issue";
    } finally {
      confirmingDelete = false;
    }
  }

  function formatTime(timestamp: number) {
    const d = new Date(timestamp);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
</script>

<div class="p-4 flex flex-col gap-3">
  <!-- Viewer banner -->
  {#if isViewer}
    <div class="px-3 py-2 bg-gray-200 border border-gray-300 font-label text-[0.75rem] text-gray-600">
      You're a <strong>Viewer</strong> in this organization — this issue is read-only. Ask an admin to upgrade your role.
    </div>
  {/if}

  <!-- Title -->
  <div class="flex items-start justify-between gap-2">
    <div class="flex-1">
      {#if isEditing}
        <input bind:value={editTitle} class="input w-full" type="text" maxlength="120" />
        <textarea bind:value={editDescription} class="input w-full min-h-16 mt-1.5" placeholder="Description..." rows="3"></textarea>
        <div class="flex gap-1.5 mt-1.5">
          <button class="button button--accent button--compact" onclick={saveEdit}>Save</button>
          <button class="button button--secondary button--compact" onclick={() => { isEditing = false; }}>Cancel</button>
        </div>
      {:else if canEdit}
        <button
          class="m-0 border-0 bg-transparent p-0 text-left font-sans text-base font-semibold leading-tight text-gray-900 cursor-pointer hover:text-accent-600"
          onclick={startEditing}
          type="button"
        >{issue.title}</button>
        {#if issue.description}
          <p class="m-0 mt-1 text-[0.8125rem] text-gray-700 leading-relaxed">{issue.description}</p>
        {/if}
      {:else}
        <h3 class="m-0 font-sans text-base font-semibold text-gray-900 leading-tight">{issue.title}</h3>
        {#if issue.description}
          <p class="m-0 mt-1 text-[0.8125rem] text-gray-700 leading-relaxed">{issue.description}</p>
        {/if}
      {/if}
    </div>
    <button class="bg-transparent border-0 p-0 cursor-pointer flex items-center text-gray-400 hover:text-gray-600" onclick={onclose}><X size={16} /></button>
  </div>

  <!-- Fields: Status, Priority, Assignee -->
  <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
    <div class="flex flex-col gap-1">
      <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Status</span>
      {#if canMove}
        <select
          class="select select--compact"
          value={issue.status}
          onchange={(e) => handleStatusChange(e.currentTarget.value)}
        >
          {#each statusOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else}
        <span class="font-label text-[0.75rem] text-gray-700">{statusOptions.find((o) => o.value === issue.status)?.label}</span>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Priority</span>
      {#if canEdit}
        <select
          class="select select--compact"
          value={issue.priority}
          onchange={(e) => handlePriorityChange(e.currentTarget.value)}
        >
          {#each priorityOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else}
        <span class="font-label text-[0.75rem] text-gray-700">{priorityOptions.find((o) => o.value === issue.priority)?.label ?? "None"}</span>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Assignee</span>
      {#if canAssign}
        <select
          class="select select--compact"
          value={issue.assigneeUserId ?? ""}
          onchange={(e) => handleAssigneeChange(e.currentTarget.value)}
        >
          <option value="">Unassigned</option>
          {#each members as member (member.userId)}
            <option value={member.userId}>{member.name}</option>
          {/each}
        </select>
      {:else if canMove}
        <!-- Members: self-assign only -->
        <select
          class="select select--compact"
          value={issue.assigneeUserId === currentUserId ? currentUserId : issue.assigneeUserId ?? ""}
          onchange={(e) => handleAssigneeChange(e.currentTarget.value)}
        >
          <option value={currentUserId}>Me</option>
          {#if issue.assigneeUserId && issue.assigneeUserId !== currentUserId}
            <option value={issue.assigneeUserId}>{issue.assigneeName}</option>
          {/if}
        </select>
      {:else}
        <span class="font-label text-[0.75rem] text-gray-700">{issue.assigneeName ?? "Unassigned"}</span>
      {/if}
    </div>
  </div>

  <!-- Labels -->
  {#if issue.labels.length > 0}
    <div class="flex gap-1 flex-wrap">
      {#each issue.labels as label (`${issue._id}-${label}`)}
        <span class="chip chip--grant">{label}</span>
      {/each}
    </div>
  {/if}

  <!-- Comments -->
  <div class="flex flex-col gap-2 mt-1">
    {#if comments.length > 0}
      <div class="flex flex-col gap-1.5">
        {#each comments as comment (comment._id)}
          <div class="flex items-start gap-2 py-1.5 border-b border-gray-200">
            <div class="flex-1">
              <span class="font-label text-[0.6875rem] font-semibold text-gray-700">{comment.authorName}</span>
              <span class="font-label text-[0.6rem] text-gray-400 ml-1">{formatTime(comment.createdAt)}</span>
              <p class="m-0 mt-0.5 text-[0.8125rem] text-gray-800">{comment.body}</p>
            </div>
            {#if canDeleteComments || comment.authorUserId === currentUserId}
              <button
                class="bg-transparent border-0 p-0 cursor-pointer flex items-center text-gray-400 hover:text-accent-600"
                onclick={() => handleDeleteComment(comment._id)}
              >
                <Trash size={14} />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if canComment}
      <form class="flex gap-1.5 items-start" onsubmit={(e) => { e.preventDefault(); handleAddComment(); }}>
        <input
          bind:value={newComment}
          class="input input--compact flex-1"
          maxlength="500"
          placeholder="Add a comment..."
          type="text"
        />
        <button
          class="button button--secondary button--compact"
          disabled={isSubmittingComment || newComment.trim().length === 0}
          type="submit"
        >
          {isSubmittingComment ? "Posting..." : "Post"}
        </button>
      </form>
    {/if}
  </div>

  <!-- Delete (admin only) -->
  {#if canDelete}
    <div class="mt-2 pt-2 border-t border-gray-200">
      <button
        class="button button--compact font-label text-[0.72rem] {confirmingDelete ? 'button--accent' : 'text-accent-600 border border-accent-400 bg-transparent hover:bg-accent-500/10'}"
        onclick={handleDeleteIssue}
      >
        {confirmingDelete ? "Confirm delete" : "Delete issue"}
      </button>
      {#if confirmingDelete}
        <button class="button button--ghost ml-2" onclick={() => { confirmingDelete = false; }}>cancel</button>
      {/if}
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
