<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";

  let { client, groupId } = $props<{ client: ConvexClient; groupId: string }>();

  const policy = useQuery(api.auth.group.getPolicy, () => ({ groupId }));

  let initialized = $state(false);
  let oidcLinking = $state<"verifiedEmail" | "none">("none");
  let samlLinking = $state<"verifiedEmail" | "none">("none");
  let jitMode = $state<"off" | "createUser" | "createUserAndMembership">("off");
  let deprovisionMode = $state<"soft" | "hard">("soft");

  let isUpdating = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  $effect(() => {
    if (policy.data && !initialized) {
      oidcLinking = policy.data.identity?.accountLinking?.oidc ?? "none";
      samlLinking = policy.data.identity?.accountLinking?.saml ?? "none";
      jitMode = policy.data.provisioning?.jit?.mode ?? "off";
      deprovisionMode = policy.data.provisioning?.deprovision?.mode ?? "soft";
      initialized = true;
    }
  });

  async function handleUpdate() {
    isUpdating = true;
    errorMessage = null;
    successMessage = null;
    try {
      await client.mutation(api.auth.group.updatePolicy, {
        groupId,
        patch: {
          identity: { accountLinking: { oidc: oidcLinking, saml: samlLinking } },
          provisioning: { jit: { mode: jitMode }, deprovision: { mode: deprovisionMode } },
        },
      });
      successMessage = "Policy updated";
      setTimeout(() => { successMessage = null; }, 3000);
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to update policy";
    } finally {
      isUpdating = false;
    }
  }
</script>

<div class="flex flex-col gap-6">
  {#if policy.isLoading}
    <p class="muted">Loading policy…</p>
  {:else}
    <div class="border border-gray-300 bg-white p-6 flex flex-col gap-5">
      <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Account Linking</p>
      <div class="grid gap-5 md:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">OIDC Linking</span>
          <select id="oidc-linking" class="select" bind:value={oidcLinking}>
            <option value="verifiedEmail">Verified email</option>
            <option value="none">None</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">SAML Linking</span>
          <select id="saml-linking" class="select" bind:value={samlLinking}>
            <option value="verifiedEmail">Verified email</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
    </div>

    <div class="border border-gray-300 bg-white p-6 flex flex-col gap-5">
      <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Provisioning</p>
      <div class="grid gap-5 md:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">JIT Provisioning</span>
          <select id="jit-mode" class="select" bind:value={jitMode}>
            <option value="off">Off</option>
            <option value="createUser">Create user</option>
            <option value="createUserAndMembership">Create user & membership</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">Deprovision Mode</span>
          <select id="deprovision-mode" class="select" bind:value={deprovisionMode}>
            <option value="soft">Soft</option>
            <option value="hard">Hard</option>
          </select>
        </label>
      </div>

      <div class="flex items-center gap-3 pt-2 border-t border-gray-200">
        <button class="button button--accent" disabled={isUpdating} onclick={handleUpdate}>
          {isUpdating ? "Updating…" : "Update policy"}
        </button>
        {#if successMessage}
          <span class="font-label text-xs font-semibold text-green-700">{successMessage}</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
