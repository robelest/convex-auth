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

  const connections = useQuery(api.auth.group.listConnections, () => ({ where: { groupId } }));
  const visibleConnections = $derived.by(() =>
    (connections.data?.items ?? []).filter(
      (connection) => connection.status !== "draft",
    ),
  );
</script>

{#if showForm}
  <NewConnectionForm
    {client}
    {groupId}
    {siteUrl}
    ondone={() => {
      showForm = false;
    }}
  />
{:else}
  <section class="flex flex-col">
    <h2 class="section-header">SSO Connections</h2>
    <p class="m-0 mt-1 mb-4 font-label text-[0.8125rem] text-gray-500 max-w-2xl">
      Manage group-owned identity provider connections, domain routing, and protocol-specific configuration from one place.
    </p>

    {#if connections.isLoading}
    <p class="m-0 font-label text-[0.8125rem] text-gray-500">Loading...</p>
    {:else if connections.data}
      {#if visibleConnections.length > 0}
      <div class="flex flex-col gap-4">
        {#each visibleConnections as connection (connection._id)}
          <ConnectionCard
            {client}
            {connection}
            {siteUrl}
          />
        {/each}
      </div>
      {:else}
      <p class="m-0 font-label text-[0.8125rem] text-gray-500">No SSO connections configured.</p>
      {/if}
    {/if}

    <button
      class="button button--secondary mt-4 self-start"
      onclick={() => {
        showForm = true;
      }}
    >
      New connection
    </button>
  </section>
{/if}
