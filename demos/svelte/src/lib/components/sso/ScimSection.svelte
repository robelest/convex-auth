<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import Copy from "phosphor-svelte/lib/Copy";
  import Check from "phosphor-svelte/lib/Check";

  let { client, connectionId } = $props<{ client: ConvexClient; connectionId: string }>();

  const scim = useQuery(api.auth.group.getScim, () => ({ connectionId }));

  let scimCredentials = $state<{ basePath: string; token: string } | null>(null);
  let isEnabling = $state(false);
  let errorMessage = $state<string | null>(null);
  let copied = $state(false);

  const isConfigured = $derived(scim.data != null || scimCredentials != null);
  const displayBasePath = $derived(scimCredentials?.basePath ?? scim.data?.basePath ?? "");
  const displayToken = $derived(scimCredentials?.token ?? scim.data?.token ?? "");

  async function handleEnable() {
    isEnabling = true;
    errorMessage = null;
    try {
      const result = await client.mutation(api.auth.group.configureScim, { connectionId });
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
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // silently fail
    }
  }
</script>

<div class="flex flex-col gap-4">
  {#if scim.isLoading}
    <p class="muted">Loading SCIM configuration…</p>
  {:else if isConfigured}
    <div class="border border-gray-300 bg-white p-6 flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">SCIM Provisioning</p>
        <span class="font-label text-[0.5625rem] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 border text-green-800 bg-green-50 border-green-300">Active</span>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="font-label text-xs font-semibold text-gray-700">Endpoint</span>
        <input class="input font-mono text-xs" value={displayBasePath} readonly />
      </label>

      {#if displayToken}
        <div class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">Bearer Token</span>
          <div class="flex items-center gap-2">
            <input class="input flex-1 font-mono text-xs" value={displayToken} readonly type="password" />
            <button class="button button--secondary button--compact" onclick={handleCopyToken}>
              {#if copied}
                <Check size={14} class="text-green-600" />
              {:else}
                <Copy size={14} />
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="border border-gray-300 bg-white p-6 flex flex-col gap-4">
      <p class="muted">Enable SCIM to automatically provision and deprovision users from your identity provider.</p>
      <button class="button button--accent self-start" disabled={isEnabling} onclick={handleEnable}>
        {isEnabling ? "Enabling…" : "Enable SCIM"}
      </button>
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
