<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import Clock from "svelte-radix/Clock.svelte";

  let { groupId } = $props<{ groupId: string }>();

  const audit = useQuery(api.auth.group.listAudit, () => ({
    groupId,
    paginationOpts: { numItems: 20, cursor: null },
  }));
  type AuditEvent = {
    _id: string;
    kind: string;
    actorType: string;
    occurredAt: number;
  };
  const auditPage = $derived(
    ((audit.data as { page: AuditEvent[] } | undefined)?.page ?? []),
  );

  function clockTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function fullTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
</script>

<div class="flex flex-col gap-4">
  {#if audit.isLoading}
    <p class="muted">Loading audit log…</p>
  {:else if audit.data}
    {#if auditPage.length > 0}
      <div class="panel overflow-hidden">
        {#each auditPage as event, i (event._id)}
          <div class="row {i % 2 === 1 ? 'bg-background-primary' : ''}">
            <span class="font-label text-[0.8125rem] font-semibold text-content-primary flex-1 break-all">{event.kind}</span>
            <span class="chip shrink-0 uppercase tracking-[0.08em]">{event.actorType}</span>
            <span
              class="font-label text-xs text-content-tertiary shrink-0 inline-flex w-[5.75rem] items-center justify-end gap-1"
              title={fullTime(event.occurredAt)}
              aria-label={fullTime(event.occurredAt)}
            >
              <Clock size="13" aria-hidden="true" />
              {clockTime(event.occurredAt)}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted">No audit events yet.</p>
    {/if}
  {/if}
</div>
