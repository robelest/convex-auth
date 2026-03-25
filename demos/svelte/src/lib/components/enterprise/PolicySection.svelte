<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";

  let { client, enterpriseId } = $props<{ client: ConvexClient; enterpriseId: string }>();

  const policy = useQuery(api.auth.enterprise.getPolicy, () => ({ enterpriseId }));

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
      await client.mutation(api.auth.enterprise.updatePolicy, {
        enterpriseId,
        patch: {
          identity: { accountLinking: { oidc: oidcLinking, saml: samlLinking } },
          provisioning: { jit: { mode: jitMode }, deprovision: { mode: deprovisionMode } },
        },
      });
      successMessage = "Policy updated";
      setTimeout(() => {
        successMessage = null;
      }, 3000);
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to update policy";
    } finally {
      isUpdating = false;
    }
  }
</script>

<section class="flex flex-col">
  <h2 class="section-header">Policy</h2>

  {#if policy.isLoading}
    <p class="m-0 font-label text-[0.8125rem] text-gray-500">Loading...</p>
  {:else}
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500" for="oidc-linking">Account Linking (OIDC)</label>
        <select
          id="oidc-linking"
          class="select select--compact"
          bind:value={oidcLinking}
        >
          <option value="verifiedEmail">verified email</option>
          <option value="none">none</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500" for="saml-linking">Account Linking (SAML)</label>
        <select
          id="saml-linking"
          class="select select--compact"
          bind:value={samlLinking}
        >
          <option value="verifiedEmail">verified email</option>
          <option value="none">none</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500" for="jit-mode">JIT Provisioning Mode</label>
        <select
          id="jit-mode"
          class="select select--compact"
          bind:value={jitMode}
        >
          <option value="off">off</option>
          <option value="createUser">createUser</option>
          <option value="createUserAndMembership">createUserAndMembership</option>
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500" for="deprovision-mode">Deprovision Mode</label>
        <select
          id="deprovision-mode"
          class="select select--compact"
          bind:value={deprovisionMode}
        >
          <option value="soft">soft</option>
          <option value="hard">hard</option>
        </select>
      </div>
    </div>

    <div class="flex items-center gap-3 mt-4">
      <button
        class="button button--accent button--compact"
        disabled={isUpdating}
        onclick={handleUpdate}
      >
        {isUpdating ? "Updating..." : "Update policy"}
      </button>

      {#if successMessage}
        <span class="font-label text-xs font-semibold text-[#2d7a3a]">{successMessage}</span>
      {/if}
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</section>
