<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { idpTemplates } from "$lib/components/sso/idp-templates";
  import Copy from "phosphor-svelte/lib/Copy";
  import Check from "phosphor-svelte/lib/Check";

  let { client, groupId, siteUrl, ondone } = $props<{
    client: ConvexClient;
    groupId: string;
    siteUrl: string | null;
    ondone: (connectionId: string | null) => void;
  }>();

  type Step = "info" | "oidc" | "samlApp" | "samlMetadata";

  let step = $state<Step>("info");
  let connectionId = $state<string | null>(null);

  let name = $state("");
  let emailDomain = $state("");
  let providerId = $state("okta");
  let protocol = $state<"oidc" | "saml">("oidc");
  let fieldValues = $state<Record<string, string>>({});
  let metadataUrl = $state("");
  let metadataXml = $state("");
  let samlSignAuthnRequests = $state(false);
  let samlSubjectAttr = $state("");
  let samlEmailAttr = $state("");
  let samlNameAttr = $state("");
  let samlFirstNameAttr = $state("");
  let samlLastNameAttr = $state("");
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);
  let metadataCopyState = $state<"idle" | "copying" | "copied" | "error">("idle");
  let copiedField = $state<string | null>(null);

  const selectedTemplate = $derived(
    idpTemplates.find((t) => t.id === providerId) ??
      idpTemplates[idpTemplates.length - 1],
  );

  const wizardSteps = $derived(
    protocol === "saml"
      ? ["General", "Configure IdP", "IdP Metadata"]
      : ["General", "Configure OIDC"],
  );
  const currentStepIndex = $derived(
    step === "info" ? 0 : step === "oidc" || step === "samlApp" ? 1 : 2,
  );

  const oidcCallbackUrl = $derived(
    connectionId && siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/oidc/callback`
      : null,
  );
  const samlEntityId = $derived(
    connectionId && siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/metadata`
      : null,
  );
  const samlAcsUrl = $derived(
    connectionId && siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/acs`
      : null,
  );
  const samlSloUrl = $derived(
    connectionId && siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/slo`
      : null,
  );
  const samlRuntimeMetadataUrl = $derived(samlEntityId);

  $effect(() => {
    const tpl = selectedTemplate;
    const fresh: Record<string, string> = {};
    for (const field of tpl.oidcFields) {
      fresh[field.key] = "";
    }
    fieldValues = fresh;
    metadataUrl = "";
    metadataXml = "";
    samlSignAuthnRequests = false;
    samlSubjectAttr = "";
    samlEmailAttr = "";
    samlNameAttr = "";
    samlFirstNameAttr = "";
    samlLastNameAttr = "";
  });

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    copiedField = field;
    setTimeout(() => { copiedField = null; }, 2000);
  }

  async function handleCreateConnection() {
    if (name.trim().length === 0) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      const result = await client.mutation(api.auth.group.createConnection, {
        groupId, name, protocol, status: "draft",
      });
      connectionId = result.connectionId;
      step = protocol === "saml" ? "samlApp" : "oidc";
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to create connection";
    } finally {
      isSubmitting = false;
    }
  }

  async function applyDomains() {
    if (!connectionId || !emailDomain.trim()) return;
    await client.mutation(api.auth.group.setDomains, {
      connectionId,
      domains: [{ domain: emailDomain.trim(), isPrimary: true }],
    });
  }

  async function handleConfigureOidc() {
    if (!connectionId) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      const discoveryUrl = selectedTemplate.buildDiscoveryUrl(fieldValues);
      await client.mutation(api.auth.group.configureOidc, {
        connectionId,
        discovery: {
          discoveryUrl: discoveryUrl || undefined,
        },
        client: {
          id: fieldValues.clientId || "",
          secret: fieldValues.clientSecret || undefined,
        },
      });
      await applyDomains();
      await client.mutation(api.auth.group.updateConnection, {
        connectionId, data: { status: "active" },
      });
      ondone(connectionId);
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to configure OIDC";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleConfigureSaml() {
    if (!connectionId) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      await client.action(api.auth.group.configureSaml, {
        connectionId,
        metadata: {
          url: metadataUrl || undefined,
          xml: metadataXml || undefined,
        },
        request: {
          signAuthnRequests: samlSignAuthnRequests,
        },
        profile: {
          mapping: {
            subject: samlSubjectAttr.trim() || undefined,
            email: samlEmailAttr.trim() || undefined,
            name: samlNameAttr.trim() || undefined,
            firstName: samlFirstNameAttr.trim() || undefined,
            lastName: samlLastNameAttr.trim() || undefined,
          },
        },
      });
      await applyDomains();
      ondone(connectionId);
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to configure SAML";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCancel() {
    errorMessage = null;
    if (connectionId) {
      try {
        await client.mutation(api.auth.group.deleteConnection, { connectionId });
      } catch (e: unknown) {
        errorMessage = e instanceof Error ? e.message : "Failed to cancel setup";
        return;
      }
    }
    ondone(null);
  }

  async function handleCopyMetadataXml() {
    if (!connectionId) return;
    metadataCopyState = "copying";
    errorMessage = null;
    try {
      const metadata = await client.query(api.auth.group.metadata, { connectionId });
      await navigator.clipboard.writeText(metadata);
      metadataCopyState = "copied";
    } catch (e: unknown) {
      metadataCopyState = "error";
      errorMessage = e instanceof Error ? e.message : "Failed to copy metadata XML";
    }
  }
</script>

<div class="flex flex-col gap-6">
  <!-- Step indicator -->
  <div class="flex items-center gap-0">
    {#each wizardSteps as wizardStep, index (wizardStep)}
      <div class="flex items-center gap-3 flex-1 {index > 0 ? 'pl-4' : ''}">
        <div class="flex items-center justify-center w-8 h-8 border-2 font-label text-sm font-bold shrink-0
          {index < currentStepIndex ? 'border-green-600 bg-green-50 text-green-700' : index === currentStepIndex ? 'border-accent-500 bg-accent-500 text-white' : 'border-gray-300 bg-gray-100 text-gray-400'}">
          {#if index < currentStepIndex}
            <Check size={16} weight="bold" />
          {:else}
            {index + 1}
          {/if}
        </div>
        <span class="font-label text-[0.8125rem] font-semibold {index === currentStepIndex ? 'text-gray-900' : index < currentStepIndex ? 'text-green-700' : 'text-gray-400'}">{wizardStep}</span>
        {#if index < wizardSteps.length - 1}
          <div class="flex-1 h-px bg-gray-300 ml-3"></div>
        {/if}
      </div>
    {/each}
  </div>

  {#if step === "info"}
    <form class="border border-gray-300 bg-white p-6 flex flex-col gap-5" onsubmit={(e) => { e.preventDefault(); handleCreateConnection(); }}>
      <label class="flex flex-col gap-1.5">
        <span class="font-label text-xs font-semibold text-gray-700">Connection name</span>
        <input bind:value={name} class="input" type="text" placeholder="ACME Corp SSO" required />
        <span class="font-label text-[0.72rem] text-gray-400 italic">A descriptive name for this SSO connection</span>
      </label>

      <label class="flex flex-col gap-1.5">
        <span class="font-label text-xs font-semibold text-gray-700">User email domain</span>
        <input bind:value={emailDomain} class="input" type="text" placeholder="acme.com" />
        <span class="font-label text-[0.72rem] text-gray-400 italic">Email domain of users who sign in via this connection</span>
      </label>

      <!-- IdP selector as cards -->
      <div class="flex flex-col gap-1.5">
        <span class="font-label text-xs font-semibold text-gray-700">Identity Provider</span>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          {#each idpTemplates as tpl (tpl.id)}
            <button
              type="button"
              class="relative flex flex-col items-center gap-2 border px-4 py-4 cursor-pointer transition-colors text-center
                {providerId === tpl.id ? 'border-accent-500 bg-accent-500/5' : 'border-gray-300 bg-white hover:bg-gray-50'}"
              onclick={() => { providerId = tpl.id; }}
            >
              <span class="font-label text-[0.8125rem] font-semibold {providerId === tpl.id ? 'text-accent-600' : 'text-gray-900'}">{tpl.label}</span>
              <span class="font-label text-[0.625rem] text-gray-400">{tpl.protocols.map((p) => p.toUpperCase()).join(' / ')}</span>
              {#if providerId === tpl.id}
                <div class="absolute top-0 left-0 w-full h-[2px] bg-accent-500"></div>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="font-label text-xs font-semibold text-gray-700">Protocol</span>
        <select bind:value={protocol} class="select">
          {#each selectedTemplate.protocols as proto (proto)}
            <option value={proto}>{proto.toUpperCase()}</option>
          {/each}
        </select>
      </label>

      {#if errorMessage}
        <p class="error-banner">{errorMessage}</p>
      {/if}

      <div class="flex items-center gap-3 pt-2 border-t border-gray-200">
        <button class="button button--accent" type="submit" disabled={isSubmitting || name.trim().length === 0}>
          {isSubmitting ? "Creating…" : "Continue"}
        </button>
        <button class="button button--secondary" type="button" onclick={handleCancel}>Cancel</button>
      </div>
    </form>

  {:else if step === "oidc"}
    <form class="border border-gray-300 bg-white p-6 flex flex-col gap-5" onsubmit={(e) => { e.preventDefault(); handleConfigureOidc(); }}>
      <!-- SP values callout -->
      <div class="border border-gray-300 bg-gray-100 p-4 flex flex-col gap-3">
        <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Copy to your Identity Provider</p>
        {#if oidcCallbackUrl}
          <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
            <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400 w-24 shrink-0">Redirect URI</span>
            <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all min-w-0">{oidcCallbackUrl}</code>
            <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyToClipboard(oidcCallbackUrl, 'redirect')}>
              {#if copiedField === 'redirect'}
                <Check size={14} class="text-green-600" />
              {:else}
                <Copy size={14} />
              {/if}
            </button>
          </div>
        {:else}
          <p class="muted">Set CONVEX_SITE_URL to generate the redirect URI.</p>
        {/if}
      </div>

      <!-- IdP fields -->
      <div class="flex flex-col gap-4">
        <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Paste from your Identity Provider</p>
        {#each selectedTemplate.oidcFields as field (field.key)}
          <label class="flex flex-col gap-1.5">
            <span class="font-label text-xs font-semibold text-gray-700">{field.label}</span>
            <div class="flex items-center min-w-0">
              <input
                class="input flex-1 min-w-0"
                type={field.type ?? "text"}
                placeholder={field.placeholder}
                value={fieldValues[field.key] ?? ""}
                oninput={(e) => { fieldValues = { ...fieldValues, [field.key]: (e.target as HTMLInputElement).value }; }}
              />
              {#if field.suffix}
                <span class="py-2 px-3 border border-gray-300 border-l-0 bg-gray-100 font-label text-xs text-gray-500 whitespace-nowrap">{field.suffix}</span>
              {/if}
            </div>
          </label>
        {/each}
        <p class="m-0 font-label text-[0.72rem] text-gray-400 italic">{selectedTemplate.helpText}</p>
      </div>

      {#if errorMessage}
        <p class="error-banner">{errorMessage}</p>
      {/if}

      <div class="flex items-center gap-3 pt-2 border-t border-gray-200">
        <button class="button button--accent" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Configuring…" : "Save & Activate"}
        </button>
        <button class="button button--secondary" type="button" onclick={handleCancel}>Cancel</button>
      </div>
    </form>

  {:else if step === "samlApp"}
    <div class="border border-gray-300 bg-white p-6 flex flex-col gap-5">
      <div class="border border-gray-300 bg-gray-100 p-5 flex flex-col gap-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Copy these values into your Identity Provider</p>
          {#if connectionId}
            <button class="button button--secondary button--compact" type="button" disabled={metadataCopyState === "copying"} onclick={handleCopyMetadataXml}>
              {metadataCopyState === "copying" ? "Copying…" : metadataCopyState === "copied" ? "Metadata copied" : "Copy metadata XML"}
            </button>
          {/if}
        </div>

        {#if samlEntityId && samlAcsUrl && samlSloUrl}
          <div class="flex flex-col gap-3">
            {#each [
              { label: "Entity ID", value: samlEntityId },
              { label: "ACS URL", value: samlAcsUrl },
              { label: "SLO URL", value: samlSloUrl },
            ] as item (item.label)}
              <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400 w-20 shrink-0">{item.label}</span>
                <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all min-w-0">{item.value}</code>
                <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyToClipboard(item.value, item.label)}>
                  {#if copiedField === item.label}
                    <Check size={14} class="text-green-600" />
                  {:else}
                    <Copy size={14} />
                  {/if}
                </button>
              </div>
            {/each}

            {#if samlRuntimeMetadataUrl}
              <div class="border-t border-gray-300 pt-3 flex flex-col gap-1">
                <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400">Runtime metadata URL</span>
                <p class="m-0 font-label text-[0.72rem] text-gray-400 italic">Serves the hosted metadata document after activation.</p>
                <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                  <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all min-w-0">{samlRuntimeMetadataUrl}</code>
                  <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyToClipboard(samlRuntimeMetadataUrl, 'metadata')}>
                    {#if copiedField === 'metadata'}
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
          <p class="muted">Set CONVEX_SITE_URL to generate your SAML setup values.</p>
        {/if}
      </div>

      {#if errorMessage}
        <p class="error-banner">{errorMessage}</p>
      {/if}

      <div class="flex items-center gap-3 pt-2 border-t border-gray-200">
        <button class="button button--accent" type="button" onclick={() => { step = "samlMetadata"; }}>I configured my IdP</button>
        <button class="button button--secondary" type="button" onclick={handleCancel}>Cancel</button>
      </div>
    </div>

  {:else}
    <form class="border border-gray-300 bg-white p-6 flex flex-col gap-5" onsubmit={(e) => { e.preventDefault(); handleConfigureSaml(); }}>
      <div class="flex flex-col gap-4">
        <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Paste metadata from your Identity Provider</p>
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">Metadata URL</span>
          <input bind:value={metadataUrl} class="input" type="url" placeholder="https://idp.example.com/.../metadata" />
        </label>
        <div class="divider"><span>or</span></div>
        <label class="flex flex-col gap-1.5">
          <span class="font-label text-xs font-semibold text-gray-700">Metadata XML</span>
          <textarea bind:value={metadataXml} class="input resize-y min-h-20 font-mono text-[0.72rem] py-2" rows="5" placeholder="<EntityDescriptor ..."></textarea>
        </label>
      </div>

      <div class="flex flex-col gap-4 border-t border-gray-200 pt-5">
        <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Attribute mapping</p>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="flex flex-col gap-1.5">
            <span class="font-label text-xs font-semibold text-gray-700">Subject</span>
            <input bind:value={samlSubjectAttr} class="input" type="text" placeholder="NameID fallback" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="font-label text-xs font-semibold text-gray-700">Email</span>
            <input bind:value={samlEmailAttr} class="input" type="text" placeholder="email" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="font-label text-xs font-semibold text-gray-700">Display name</span>
            <input bind:value={samlNameAttr} class="input" type="text" placeholder="displayName" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="font-label text-xs font-semibold text-gray-700">First name</span>
            <input bind:value={samlFirstNameAttr} class="input" type="text" placeholder="firstName" />
          </label>
          <label class="flex flex-col gap-1.5 md:col-span-2">
            <span class="font-label text-xs font-semibold text-gray-700">Last name</span>
            <input bind:value={samlLastNameAttr} class="input" type="text" placeholder="lastName" />
          </label>
        </div>

        <label class="flex items-center gap-2">
          <input bind:checked={samlSignAuthnRequests} type="checkbox" />
          <span class="font-label text-[0.75rem] text-gray-700">Sign AuthnRequests</span>
        </label>
      </div>

      {#if errorMessage}
        <p class="error-banner">{errorMessage}</p>
      {/if}

      <div class="flex items-center gap-3 pt-2 border-t border-gray-200">
        <button class="button button--accent" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Configuring…" : "Save & Activate"}
        </button>
        <button class="button button--secondary" type="button" onclick={() => { step = "samlApp"; }}>Back</button>
        <button class="button button--secondary" type="button" onclick={handleCancel}>Cancel</button>
      </div>
    </form>
  {/if}
</div>
