<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import ConnectionCard from "./ConnectionCard.svelte";
  import NewConnectionForm from "./NewConnectionForm.svelte";

  let { client, groupId, siteUrl } = $props<{
    client: ConvexClient;
    groupId: string;
    siteUrl: string | null;
  }>();

  let showForm = $state(false);

  const connections = useQuery(api.auth.enterprise.listConnections, () => ({ where: { groupId } }));
</script>

<section class="flex flex-col">
  <h2 class="section-header">SSO Connections</h2>

  {#if connections.isLoading}
    <p class="m-0 font-label text-[0.8125rem] text-gray-500">Loading...</p>
  {:else if connections.data}
    {#if connections.data.items.length > 0}
      <div class="flex flex-col gap-2">
        {#each connections.data.items as connection}
          <ConnectionCard {client} {connection} />
        {/each}
      </div>
    {:else}
      <p class="m-0 font-label text-[0.8125rem] text-gray-500">No SSO connections configured.</p>
    {/if}
  {/if}

  {#if !showForm}
    <button
      class="button button--secondary button--compact mt-2"
      onclick={() => { showForm = true; }}
    >
      New connection
    </button>
  {/if}

  {#if showForm}
    <div class="mt-2">
      <NewConnectionForm
        {client}
        {groupId}
        {siteUrl}
        oncreated={() => { showForm = false; }}
      />
    </div>
  {/if}
</section>
