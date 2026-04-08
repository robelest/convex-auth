<script lang="ts">
  import { useQuery, useConvexClient } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import ConnectionListItem from "$lib/components/sso/ConnectionListItem.svelte";
  import PolicySection from "$lib/components/sso/PolicySection.svelte";
  import AuditSection from "$lib/components/sso/AuditSection.svelte";
  import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";

  let { data } = $props();
  const client = useConvexClient();

  const connections = useQuery(api.auth.group.listConnections, () => ({
    where: { groupId: data.groupId },
  }));
  const visibleConnections = $derived.by(() =>
    (connections.data?.items ?? []).filter((connection) => connection.status !== "draft"),
  );
</script>

<div class="col-span-full max-w-5xl mx-auto w-full px-8 py-10 flex flex-col gap-8 max-md:px-4 max-md:py-6">
  <!-- Header -->
  <div class="flex items-start justify-between gap-4 flex-wrap">
    <div class="flex items-center gap-4">
      <div class="relative">
        <div class="w-12 h-12 bg-accent-500/10 border border-accent-500/20 flex items-center justify-center">
          <ShieldCheck size={24} weight="duotone" class="text-accent-500" />
        </div>
        <div class="absolute -bottom-1 -right-1 w-12 h-12 border border-gray-300 -z-10"></div>
      </div>
      <div>
        <h1 class="heading text-2xl">SSO Connections</h1>
        <p class="m-0 mt-1 font-label text-[0.8125rem] text-gray-500">
          Manage single sign-on for your organization.
        </p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <a class="button button--secondary no-underline" href="/{data.groupId}">Back</a>
      <a class="button button--accent no-underline" href="/{data.groupId}/sso/new">New connection</a>
    </div>
  </div>

  <!-- Connections list -->
  {#if connections.isLoading}
    <p class="muted">Loading connections…</p>
  {:else if visibleConnections.length === 0}
    <div class="relative border border-gray-300 bg-white p-12 text-center flex flex-col items-center gap-5">
      <div class="absolute top-4 left-4 w-8 h-8 border border-gray-200"></div>
      <div class="absolute top-6 left-6 w-8 h-8 border border-gray-200"></div>
      <ShieldCheck size={48} weight="duotone" class="text-gray-300" />
      <div>
        <p class="m-0 font-display text-xl font-medium text-gray-900">No connections configured</p>
        <p class="m-0 mt-2 font-label text-[0.8125rem] text-gray-500">Set up your first SSO connection to enable single sign-on.</p>
      </div>
      <a class="button button--accent no-underline" href="/{data.groupId}/sso/new">Create connection</a>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each visibleConnections as connection (connection._id)}
        <ConnectionListItem {connection} groupId={data.groupId} />
      {/each}
    </div>
  {/if}

  <!-- Group Policy -->
  <div class="flex flex-col gap-2">
    <h2 class="heading text-lg m-0">Group Policy</h2>
    <p class="m-0 font-label text-[0.8125rem] text-gray-500">Account linking and provisioning settings for this group.</p>
  </div>
  <PolicySection {client} groupId={data.groupId} />

  <!-- Audit Log -->
  <div class="flex flex-col gap-2">
    <h2 class="heading text-lg m-0">Audit Log</h2>
    <p class="m-0 font-label text-[0.8125rem] text-gray-500">Recent SSO events across all connections.</p>
  </div>
  <AuditSection groupId={data.groupId} />
</div>
