<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { idpTemplates } from "$lib/components/enterprise/idp-templates";

  let { client, groupId, siteUrl, oncreated } = $props<{
    client: ConvexClient;
    groupId: string;
    siteUrl: string | null;
    oncreated: () => void;
  }>();

  // Step 1: basic info, Step 2: IdP setup with callback URL shown
  let step = $state<"info" | "configure">("info");
  let enterpriseId = $state<string | null>(null);

  let name = $state("");
  let emailDomain = $state("");
  let providerId = $state("okta");
  let protocol = $state<"oidc" | "saml">("oidc");
  let fieldValues = $state<Record<string, string>>({});
  let metadataUrl = $state("");
  let metadataXml = $state("");
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);

  const selectedTemplate = $derived(
    idpTemplates.find((t) => t.id === providerId) ?? idpTemplates[idpTemplates.length - 1],
  );

  // Callback URLs (only available after connection is created)
  const oidcCallbackUrl = $derived(
    enterpriseId && siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/api/auth/sso/${enterpriseId}/oidc/callback`
      : null,
  );
  const samlAcsUrl = $derived(
    enterpriseId && siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/api/auth/sso/${enterpriseId}/saml/acs`
      : null,
  );

  // Reset field values when provider changes
  $effect(() => {
    const tpl = selectedTemplate;
    const fresh: Record<string, string> = {};
    for (const field of tpl.oidcFields) {
      fresh[field.key] = "";
    }
    fieldValues = fresh;
    metadataUrl = "";
    metadataXml = "";
  });

  async function handleCreateConnection() {
    if (name.trim().length === 0) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      const result = await client.mutation(api.auth.enterprise.createConnection, {
        groupId,
        name,
      });
      enterpriseId = result.enterpriseId;
      step = "configure";
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to create connection";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleConfigure() {
    if (!enterpriseId) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      if (protocol === "oidc") {
        const discoveryUrl = selectedTemplate.buildDiscoveryUrl(fieldValues);
        await client.mutation(api.auth.enterprise.configureOidc, {
          enterpriseId,
          discoveryUrl: discoveryUrl || undefined,
          clientId: fieldValues.clientId || "",
          clientSecret: fieldValues.clientSecret || undefined,
        });
      } else {
        await client.action(api.auth.enterprise.configureSaml, {
          enterpriseId,
          metadataUrl: metadataUrl || undefined,
          metadataXml: metadataXml || undefined,
        });
      }

      // Link email domain if provided
      if (emailDomain.trim()) {
        await client.mutation(api.auth.enterprise.setDomains, {
          enterpriseId,
          domains: [{ domain: emailDomain.trim(), isPrimary: true }],
        });
      }

      oncreated();
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to configure connection";
    } finally {
      isSubmitting = false;
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }
</script>

{#if step === "info"}
  <form class="flex flex-col gap-2.5" onsubmit={(e) => { e.preventDefault(); handleCreateConnection(); }}>
    <label class="flex flex-col gap-0.5">
      <span class="font-label text-xs font-semibold text-gray-700">Connection name</span>
      <input bind:value={name} class="input input--compact" type="text" placeholder="ACME Corp SSO" required />
    </label>

    <label class="flex flex-col gap-0.5">
      <span class="font-label text-xs font-semibold text-gray-700">User email domain</span>
      <input bind:value={emailDomain} class="input input--compact" type="text" placeholder="acme.com" />
      <span class="m-0 font-label text-[0.72rem] text-gray-500 italic">The email domain of users who will sign in via SSO</span>
    </label>

    <label class="flex flex-col gap-0.5">
      <span class="font-label text-xs font-semibold text-gray-700">Identity provider</span>
      <select bind:value={providerId} class="select select--compact">
        {#each idpTemplates as tpl}
          <option value={tpl.id}>{tpl.label}</option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-0.5">
      <span class="font-label text-xs font-semibold text-gray-700">Protocol</span>
      <select bind:value={protocol} class="select select--compact">
        {#each selectedTemplate.protocols as proto}
          <option value={proto}>{proto.toUpperCase()}</option>
        {/each}
      </select>
    </label>

    {#if errorMessage}
      <p class="error-banner">{errorMessage}</p>
    {/if}

    <div class="flex gap-1.5 items-center mt-1">
      <button class="button button--accent button--compact" type="submit" disabled={isSubmitting || name.trim().length === 0}>
        {isSubmitting ? "Creating..." : "Continue"}
      </button>
      <button class="button button--secondary button--compact" type="button" onclick={oncreated}>Cancel</button>
    </div>
  </form>

{:else}
  <form class="flex flex-col gap-2.5" onsubmit={(e) => { e.preventDefault(); handleConfigure(); }}>
    <!-- Show callback URL that admin needs to paste into their IdP -->
    <div class="p-2.5 border border-gray-300 bg-gray-100 flex flex-col gap-1.5 min-w-0">
      <p class="font-label text-xs font-semibold text-gray-700 m-0">
        {protocol === "oidc" ? "Redirect URI" : "ACS URL"} — paste this into your IdP
      </p>
      {#if protocol === "oidc" && oidcCallbackUrl}
        <div class="flex items-center gap-1.5 max-md:flex-col max-md:items-stretch">
          <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all bg-transparent border-0 p-0 min-w-0">{oidcCallbackUrl}</code>
          <button class="button button--secondary button--compact max-md:self-start" type="button" onclick={() => copyToClipboard(oidcCallbackUrl!)}>Copy</button>
        </div>
      {:else if protocol === "saml" && samlAcsUrl}
        <div class="flex items-center gap-1.5 max-md:flex-col max-md:items-stretch">
          <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all bg-transparent border-0 p-0 min-w-0">{samlAcsUrl}</code>
          <button class="button button--secondary button--compact max-md:self-start" type="button" onclick={() => copyToClipboard(samlAcsUrl!)}>Copy</button>
        </div>
      {:else}
        <p class="muted">Set CONVEX_SITE_URL to generate callback URL</p>
      {/if}
    </div>

    <!-- Protocol-specific fields -->
    {#if protocol === "oidc"}
      {#each selectedTemplate.oidcFields as field (field.key)}
        <label class="flex flex-col gap-0.5">
          <span class="font-label text-xs font-semibold text-gray-700">{field.label}</span>
          <div class="flex items-center min-w-0">
            <input
              class="input input--compact flex-1 min-w-0"
              type={field.type ?? "text"}
              placeholder={field.placeholder}
              value={fieldValues[field.key] ?? ""}
              oninput={(e) => { fieldValues = { ...fieldValues, [field.key]: (e.target as HTMLInputElement).value }; }}
            />
            {#if field.suffix}
              <span class="py-[0.35rem] px-2 border border-gray-300 border-l-0 bg-gray-100 font-label text-xs text-gray-500 whitespace-nowrap">{field.suffix}</span>
            {/if}
          </div>
        </label>
      {/each}
      <p class="m-0 font-label text-[0.72rem] text-gray-500 italic">{selectedTemplate.helpText}</p>
    {:else}
      <label class="flex flex-col gap-0.5">
        <span class="font-label text-xs font-semibold text-gray-700">Metadata URL</span>
        <input bind:value={metadataUrl} class="input input--compact" type="url" placeholder="https://idp.example.com/.../metadata" />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="font-label text-xs font-semibold text-gray-700">Or paste metadata XML</span>
        <textarea bind:value={metadataXml} class="input input--compact resize-y min-h-16 font-mono text-[0.72rem]" rows="4" placeholder="<EntityDescriptor ..."></textarea>
      </label>
    {/if}

    {#if errorMessage}
      <p class="error-banner">{errorMessage}</p>
    {/if}

    <div class="flex gap-1.5 items-center mt-1">
      <button class="button button--accent button--compact" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Configuring..." : "Save & Activate"}
      </button>
      <button class="button button--secondary button--compact" type="button" onclick={oncreated}>Cancel</button>
    </div>
  </form>
{/if}
