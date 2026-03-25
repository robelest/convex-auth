<script lang="ts">
  import { useQuery, useConvexClient } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import ConnectionsSection from "$lib/components/enterprise/ConnectionsSection.svelte";
  import ScimSection from "$lib/components/enterprise/ScimSection.svelte";
  import PolicySection from "$lib/components/enterprise/PolicySection.svelte";
  import AuditSection from "$lib/components/enterprise/AuditSection.svelte";
  import NewConnectionForm from "$lib/components/enterprise/NewConnectionForm.svelte";

  import { page } from "$app/state";
  import ArrowLeft from "phosphor-svelte/lib/ArrowLeft";

  let { data } = $props();
  const client = useConvexClient();
  const groupId = data.workspaceId;
  const siteUrl = (page.data as { siteUrl?: string | null }).siteUrl ?? null;

  const connections = useQuery(api.auth.enterprise.listConnections, () => ({
    where: { groupId },
  }));

  const hasConnection = $derived(
    connections.data != null && connections.data.items.length > 0,
  );
  const enterpriseId = $derived(
    connections.data && connections.data.items.length > 0
      ? (connections.data.items[0]._id as string)
      : null,
  );

  let step = $state<"idle" | "create" | "scim" | "done">("idle");
  let managementTab = $state<"connection" | "provisioning" | "policy" | "audit">("connection");

  const tabs = [
    { id: "connection" as const, label: "Connection" },
    { id: "provisioning" as const, label: "Provisioning" },
    { id: "policy" as const, label: "Policy" },
    { id: "audit" as const, label: "Audit" },
  ];

  function handleConnectionCreated() {
    step = "scim";
  }

  function handleScimDone() {
    step = "done";
  }
</script>

<div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6 max-md:px-4 max-md:py-5">
  <!-- Header -->
  <div class="flex justify-between items-center flex-wrap gap-2">
    <h1 class="heading text-xl m-0">Enterprise SSO</h1>
    <a class="flex items-center gap-1 font-label text-[0.75rem] font-semibold text-accent-500 hover:text-accent-600 no-underline" href="/?workspace={groupId}"><ArrowLeft size={14} /> Back to app</a>
  </div>

  {#if connections.isLoading}
    <p class="muted">Loading...</p>

  {:else if !hasConnection && step === "idle"}
    <div class="border border-gray-300 p-8 flex flex-col items-center gap-4 text-center max-md:p-5">
      <h2 class="heading text-lg m-0">Set up single sign-on</h2>
      <p class="muted max-w-md">Connect your identity provider so your team can sign in with their work credentials.</p>
      <button class="button button--accent" onclick={() => { step = "create"; }}>Get started</button>
    </div>

  {:else if !hasConnection && step === "create"}
    <div class="border border-gray-300 p-6 flex flex-col gap-4 max-md:p-4">
      <h2 class="section-header">Configure SSO connection</h2>
      <NewConnectionForm {client} {groupId} {siteUrl} oncreated={handleConnectionCreated} />
    </div>

  {:else if step === "scim" && enterpriseId}
    <div class="border border-gray-300 p-6 flex flex-col gap-4 max-md:p-4">
      <h2 class="section-header">SCIM provisioning</h2>
      <p class="muted">Enable automatic user provisioning from your identity provider.</p>
      <ScimSection {client} {enterpriseId} />
      <div class="flex gap-2 mt-2">
        <button class="button button--accent button--compact" onclick={handleScimDone}>Continue</button>
        <button class="button button--secondary button--compact" onclick={handleScimDone}>Skip</button>
      </div>
    </div>

  {:else if step === "done"}
    <div class="border border-gray-300 p-8 flex flex-col items-center gap-4 text-center max-md:p-5">
      <h2 class="heading text-lg m-0">SSO configured</h2>
      <p class="muted">Users with a matching email domain can now sign in via SSO.</p>
      <div class="flex gap-2">
        <a class="button button--accent button--compact" href="/?workspace={groupId}">Go to app</a>
        <button class="button button--secondary button--compact" onclick={() => { step = "idle"; }}>Manage</button>
      </div>
    </div>

  {:else}
    <!-- Management view with tabs -->
    <div class="flex gap-0 border-b border-gray-300">
      {#each tabs as tab}
        <button
          class="py-2 px-4 border-0 border-b-2 bg-transparent font-label text-[0.75rem] font-medium cursor-pointer {managementTab === tab.id ? 'border-b-accent-500 text-accent-600 font-semibold' : 'border-b-transparent text-gray-500 hover:text-gray-700'}"
          onclick={() => { managementTab = tab.id; }}
        >{tab.label}</button>
      {/each}
    </div>

    <div class="border border-gray-300 p-5 flex flex-col max-md:p-4">
      {#if managementTab === "connection"}
        <ConnectionsSection {client} {groupId} {siteUrl} />
      {:else if managementTab === "provisioning" && enterpriseId}
        <ScimSection {client} {enterpriseId} />
      {:else if managementTab === "policy" && enterpriseId}
        <PolicySection {client} {enterpriseId} />
      {:else if managementTab === "audit"}
        <AuditSection {groupId} />
      {:else}
        <p class="muted">Create a connection first to access this section.</p>
      {/if}
    </div>
  {/if}
</div>
