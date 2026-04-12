<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";

  let { groupId } = $props<{ groupId: string }>();

  const audit = useQuery(api.auth.group.listAudit, () => ({ groupId, limit: 20 }));

  function relativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<div class="flex flex-col gap-4">
  {#if audit.isLoading}
    <p class="muted">Loading audit log…</p>
  {:else if audit.data}
    {#if audit.data.length > 0}
      <div class="border border-gray-300 bg-white">
        {#each audit.data as event, i (event._id)}
          <div class="flex items-center gap-4 px-5 py-3 {i > 0 ? 'border-t border-gray-200' : ''} {i % 2 === 1 ? 'bg-gray-50' : ''}">
            <span class="font-label text-[0.8125rem] font-semibold text-gray-900 flex-1 break-all">{event.eventType}</span>
            <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 border border-slate-400/30 text-slate-600 bg-slate-400/10 shrink-0">{event.actorType}</span>
            <span class="font-label text-xs text-gray-400 shrink-0 w-16 text-right">{relativeTime(event.occurredAt)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="muted">No audit events yet.</p>
    {/if}
  {/if}
</div>
