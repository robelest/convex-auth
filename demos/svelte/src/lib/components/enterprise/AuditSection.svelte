<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";

  let { groupId } = $props<{ groupId: string }>();

  const audit = useQuery(api.auth.enterprise.listAudit, () => ({ groupId, limit: 20 }));

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

<section class="flex flex-col">
  <h2 class="section-header">Audit Log</h2>

  {#if audit.isLoading}
    <p class="m-0 font-label text-[0.8125rem] text-gray-500">Loading...</p>
  {:else if audit.data}
    {#if audit.data.length > 0}
      <div class="flex flex-col">
        {#each audit.data as event (event._creationTime)}
          <div class="flex items-center gap-2 py-1.5 border-b border-gray-200 flex-wrap">
            <span class="font-label text-[0.8125rem] font-semibold text-gray-900 break-all">{event.eventType}</span>
            <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">{event.actorType}</span>
            <span class="ml-auto font-label text-xs text-gray-500 whitespace-nowrap">{relativeTime(event._creationTime)}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="m-0 font-label text-[0.8125rem] text-gray-500">No events yet.</p>
    {/if}
  {/if}
</section>
