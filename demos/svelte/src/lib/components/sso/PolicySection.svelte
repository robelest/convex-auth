<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";

  const roleOptions = [
    { id: "", label: "No default role" },
    { id: "viewer", label: "Viewer" },
    { id: "member", label: "Member" },
    { id: "orgAdmin", label: "Admin" },
  ] as const;
  const roleMappingPlaceholder = '{\n  "External Role": ["viewer"]\n}';

  let { client, groupId } = $props<{ client: ConvexClient; groupId: string }>();

  const policy = useQuery(api.auth.group.getPolicy, () => ({ groupId }));
  const validation = useQuery(api.auth.group.validatePolicy, () => ({ groupId }));

  let initialized = $state(false);
  let oidcLinking = $state<"verifiedEmail" | "none">("none");
  let samlLinking = $state<"verifiedEmail" | "none">("none");
  let jitMode = $state<"off" | "createUser" | "createUserAndMembership">("off");
  let deprovisionMode = $state<"soft" | "hard">("soft");
  let defaultRoleId = $state("");
  let roleMappingMode = $state<"ignore" | "map">("ignore");
  let roleMappingText = $state("{}");

  let isUpdating = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);

  const validationErrors = $derived.by(() =>
    (validation.data?.checks ?? []).filter((check) => !check.ok && check.message),
  );

  $effect(() => {
    if (policy.data && !initialized) {
      oidcLinking = policy.data.identity?.accountLinking?.oidc ?? "none";
      samlLinking = policy.data.identity?.accountLinking?.saml ?? "none";
      jitMode = policy.data.provisioning?.jit?.mode ?? "off";
      deprovisionMode = policy.data.provisioning?.deprovision?.mode ?? "soft";
      defaultRoleId = policy.data.provisioning?.jit?.defaultRoleIds?.[0] ?? "";
      roleMappingMode = policy.data.provisioning?.roles?.mode ?? "ignore";
      roleMappingText = JSON.stringify(
        policy.data.provisioning?.roles?.mapping ?? {},
        null,
        2,
      );
      initialized = true;
    }
  });

  function parseRoleMapping() {
    const parsed = JSON.parse(roleMappingText || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Role mapping must be a JSON object.");
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => {
        if (!Array.isArray(value)) {
          throw new Error(`Role mapping for ${key} must be an array of role IDs.`);
        }
        return [
          key,
          value.filter((item): item is string => typeof item === "string" && item.length > 0),
        ];
      }),
    );
  }

  async function handleUpdate() {
    isUpdating = true;
    errorMessage = null;
    successMessage = null;
    try {
      const roleMapping = parseRoleMapping();
      await client.mutation(api.auth.group.updatePolicy, {
        groupId,
        patch: {
          identity: { accountLinking: { oidc: oidcLinking, saml: samlLinking } },
          provisioning: {
            jit: {
              mode: jitMode,
              defaultRoleIds: defaultRoleId ? [defaultRoleId] : [],
            },
            deprovision: { mode: deprovisionMode },
            roles: {
              mode: roleMappingMode,
              mapping: roleMapping,
            },
          },
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
      <p class="m-0 font-label text-[0.8125rem] text-gray-500">
        This demo uses authorization roles for project access. Configure an explicit default role or external role mappings for provisioned memberships.
      </p>
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
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">Default provisioned role</span>
          <select id="default-role-id" class="select" bind:value={defaultRoleId}>
            {#each roleOptions as role (role.id)}
              <option value={role.id}>{role.label}</option>
            {/each}
          </select>
        </label>
        <label class="flex flex-col gap-1.5 md:col-span-2">
          <span class="font-label text-xs font-semibold text-gray-700">External role mapping</span>
          <select id="role-mapping-mode" class="select" bind:value={roleMappingMode}>
            <option value="ignore">Ignore external roles</option>
            <option value="map">Map external roles</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 md:col-span-2">
          <span class="font-label text-xs font-semibold text-gray-700">Role mapping JSON</span>
          <textarea
            bind:value={roleMappingText}
            class="input min-h-36 font-mono text-xs"
            placeholder={roleMappingPlaceholder}
          ></textarea>
          <span class="font-label text-[0.6875rem] text-gray-500">
            Map incoming SCIM or SSO role strings to your app's internal role IDs.
          </span>
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

      {#if validationErrors.length > 0}
        <div class="flex flex-col gap-2 pt-2 border-t border-gray-200">
          {#each validationErrors as check (`${check.name}-${check.message}`)}
            <p class="error-banner">{check.message}</p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
