<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import Copy from "phosphor-svelte/lib/Copy";

  let { client, connection } = $props<{
    client: ConvexClient;
    connection: {
      _id: string;
      name?: string;
      status?: string;
    };
  }>();

  let isLoading = $state(false);
  let errorMessage = $state<string | null>(null);
  let newDomain = $state("");
  let verificationChallenge = $state<{ domain: string; recordName: string; token: string } | null>(null);

  const domainsQuery = useQuery(api.auth.enterprise.listDomains, () => ({ enterpriseId: connection._id }));
  const domainList = $derived.by(() => {
    const raw = domainsQuery.data;
    if (!raw) return [] as Array<{ domain: string; isPrimary?: boolean; verifiedAt?: number }>;
    return (Array.isArray(raw) ? raw : (raw.items ?? [])) as Array<{ domain: string; isPrimary?: boolean; verifiedAt?: number }>;
  });

  async function handleActivate() {
    isLoading = true;
    errorMessage = null;
    try {
      await client.mutation(api.auth.enterprise.updateConnection, {
        enterpriseId: connection._id,
        data: { status: "active" },
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to activate";
    } finally {
      isLoading = false;
    }
  }

  async function handleDelete() {
    isLoading = true;
    errorMessage = null;
    try {
      await client.mutation(api.auth.enterprise.deleteConnection, {
        enterpriseId: connection._id,
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to delete";
    } finally {
      isLoading = false;
    }
  }

  async function handleAddDomain() {
    if (!newDomain.trim()) return;
    isLoading = true;
    errorMessage = null;
    try {
      const existing = domainList.map((d) => ({
        domain: d.domain,
        isPrimary: d.isPrimary ?? false,
      }));
      await client.mutation(api.auth.enterprise.setDomains, {
        enterpriseId: connection._id,
        domains: [...existing, { domain: newDomain.trim(), isPrimary: existing.length === 0 }],
      });
      newDomain = "";
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to add domain";
    } finally {
      isLoading = false;
    }
  }

  async function handleRequestVerification(domain: string) {
    isLoading = true;
    errorMessage = null;
    try {
      const result = await client.mutation(api.auth.enterprise.requestDomainVerification, {
        enterpriseId: connection._id,
        domain,
      });
      verificationChallenge = {
        domain,
        recordName: result.challenge.recordName,
        token: result.challenge.recordValue,
      };
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to request verification";
    } finally {
      isLoading = false;
    }
  }

  async function handleConfirmVerification(domain: string) {
    isLoading = true;
    errorMessage = null;
    try {
      await client.action(api.auth.enterprise.confirmDomainVerification, {
        enterpriseId: connection._id,
        domain,
      });
      verificationChallenge = null;
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Verification failed — check your DNS TXT record";
    } finally {
      isLoading = false;
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }
</script>

<!-- Connection card -->
<div class="flex flex-col gap-3 p-4 border border-gray-200 bg-white">
  <!-- Header -->
  <div class="flex justify-between items-center flex-wrap gap-2">
    <div class="flex items-center gap-2 min-w-0">
      <span class="font-label text-sm font-semibold text-gray-900 truncate">{connection.name ?? "SSO Connection"}</span>
      <span class="font-label text-xs font-semibold px-1.5 py-0.5 border shrink-0 {connection.status === 'active' ? 'text-green-800 bg-green-50 border-green-300' : 'text-gray-600 bg-gray-100 border-gray-300'}">
        {connection.status ?? "draft"}
      </span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      {#if connection.status === "draft"}
        <button class="button button--accent button--compact" disabled={isLoading} onclick={handleActivate}>Activate</button>
      {/if}
      <button class="button button--secondary button--compact" disabled={isLoading} onclick={handleDelete}>Delete</button>
    </div>
  </div>

  <!-- Domains (nested under this connection) -->
  {#if domainList.length > 0}
    <div class="flex flex-col gap-2 pl-3 border-l-2 border-gray-200">
      {#each domainList as d}
        <div class="flex items-center gap-2">
          <span class="font-label text-[0.8125rem] text-gray-800">{d.domain}</span>
          {#if d.verifiedAt}
            <span class="font-label text-[0.6875rem] font-semibold px-1.5 py-0.5 border text-green-800 bg-green-50 border-green-300">verified</span>
          {:else}
            <button class="button button--secondary button--compact" disabled={isLoading} onclick={() => handleRequestVerification(d.domain)}>Verify</button>
          {/if}
        </div>
      {/each}

      <!-- Verification challenge -->
      {#if verificationChallenge}
        <div class="flex flex-col gap-2 p-3 border border-gray-300 bg-gray-50">
          <p class="font-label text-xs font-semibold text-gray-700 m-0">Add a TXT record for {verificationChallenge.domain}:</p>
          <div class="flex flex-col gap-1.5">
            <div class="flex flex-col gap-0.5">
              <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Name</span>
              <div class="flex items-center gap-1.5">
                <input class="input input--compact flex-1 font-mono text-xs" value={verificationChallenge.recordName} readonly />
                <button class="bg-transparent border-0 p-0 cursor-pointer flex items-center text-gray-400 hover:text-gray-600" onclick={() => copyToClipboard(verificationChallenge!.recordName)}><Copy size={14} /></button>
              </div>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Value</span>
              <div class="flex items-center gap-1.5">
                <input class="input input--compact flex-1 font-mono text-xs" value={verificationChallenge.token} readonly />
                <button class="bg-transparent border-0 p-0 cursor-pointer flex items-center text-gray-400 hover:text-gray-600" onclick={() => copyToClipboard(verificationChallenge!.token)}><Copy size={14} /></button>
              </div>
            </div>
          </div>
          <button class="button button--accent button--compact" disabled={isLoading} onclick={() => handleConfirmVerification(verificationChallenge!.domain)}>
            {isLoading ? "Checking..." : "Confirm verification"}
          </button>
        </div>
      {/if}

      <!-- Add domain -->
      <div class="flex gap-1.5 items-center">
        <input bind:value={newDomain} class="input input--compact flex-1" type="text" placeholder="acme.com" />
        <button class="button button--secondary button--compact" disabled={isLoading || !newDomain.trim()} onclick={handleAddDomain}>Add domain</button>
      </div>
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
