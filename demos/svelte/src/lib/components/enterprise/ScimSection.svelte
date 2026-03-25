<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import Copy from "phosphor-svelte/lib/Copy";

  let { client, enterpriseId } = $props<{ client: ConvexClient; enterpriseId: string }>();

  const scim = useQuery(api.auth.enterprise.getScim, () => ({ enterpriseId }));

  let scimCredentials = $state<{ basePath: string; token: string } | null>(null);
  let isEnabling = $state(false);
  let errorMessage = $state<string | null>(null);
  let copyLabel = $state("Copy");

  const isConfigured = $derived(scim.data != null || scimCredentials != null);
  const displayBasePath = $derived(scimCredentials?.basePath ?? scim.data?.basePath ?? "");
  const displayToken = $derived(scimCredentials?.token ?? scim.data?.token ?? "");

  async function handleEnable() {
    isEnabling = true;
    errorMessage = null;
    try {
      const result = await client.mutation(api.auth.enterprise.configureScim, { enterpriseId });
      scimCredentials = result as { basePath: string; token: string };
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to enable SCIM";
    } finally {
      isEnabling = false;
    }
  }

  async function handleCopyToken() {
    try {
      await navigator.clipboard.writeText(displayToken);
      copyLabel = "Copied";
      setTimeout(() => { copyLabel = "Copy"; }, 2000);
    } catch {
      copyLabel = "Failed";
      setTimeout(() => { copyLabel = "Copy"; }, 2000);
    }
  }
</script>

<section class="flex flex-col">
  <h2 class="section-header">SCIM Provisioning</h2>

  {#if scim.isLoading}
    <p class="muted">Loading...</p>
  {:else if isConfigured}
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Endpoint</span>
        <div class="flex items-center gap-1.5">
          <input class="input input--compact flex-1 font-mono text-xs" value={displayBasePath} readonly />
          {#if displayToken}
            <button class="button button--secondary button--compact shrink-0" onclick={handleCopyToken}>{copyLabel}</button>
          {/if}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-label text-xs font-semibold px-1.5 py-0.5 border text-green-800 bg-green-50 border-green-300">Active</span>
      </div>
    </div>
  {:else}
    <p class="muted mb-3">
      Enable SCIM to automatically provision and deprovision users from your identity provider.
    </p>
    <button
      class="button button--accent button--compact"
      disabled={isEnabling}
      onclick={handleEnable}
    >
      {isEnabling ? "Enabling..." : "Enable SCIM"}
    </button>
  {/if}

  {#if errorMessage}
    <p class="error-banner mt-2">{errorMessage}</p>
  {/if}
</section>
