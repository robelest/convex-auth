<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { useQuery } from "convex-svelte";
  import { api } from "$convex/_generated/api.js";
  import Copy from "phosphor-svelte/lib/Copy";
  import Check from "phosphor-svelte/lib/Check";
  import Warning from "phosphor-svelte/lib/Warning";
  import ScimSection from "./ScimSection.svelte";

  let { client, connectionId, groupId, siteUrl } = $props<{
    client: ConvexClient;
    connectionId: string;
    groupId: string;
    siteUrl: string | null;
  }>();

  type ValidationResult = {
    ok: boolean;
    checks: Array<{ name: string; ok: boolean; message?: string }>;
  };

  type Tab = "config" | "domains" | "scim";
  let activeTab = $state<Tab>("config");

  let isSaving = $state(false);
  let isDeleting = $state(false);
  let errorMessage = $state<string | null>(null);
  let successMessage = $state<string | null>(null);
  let newDomain = $state("");
  let verificationChallenge = $state<{ domain: string; recordName: string; token: string } | null>(null);
  let validationResult = $state<ValidationResult | null>(null);
  let copiedField = $state<string | null>(null);

  let oidcDiscoveryUrl = $state("");
  let oidcClientId = $state("");
  let oidcClientSecret = $state("");
  let samlMetadataUrl = $state("");
  let samlMetadataXml = $state("");
  let samlSignAuthnRequests = $state(false);
  let samlSubjectAttr = $state("");
  let samlEmailAttr = $state("");
  let samlNameAttr = $state("");
  let samlFirstNameAttr = $state("");
  let samlLastNameAttr = $state("");

  const connectionQuery = useQuery(api.auth.group.getConnection, () => ({ connectionId }));
  const domainsQuery = useQuery(api.auth.group.listDomains, () => ({ connectionId }));
  const statusQuery = useQuery(api.auth.group.getConnectionStatus, () => ({ connectionId }));
  const oidcConfigQuery = useQuery(
    api.auth.group.getOidc,
    () =>
      (connectionQuery.data?.protocol ?? "oidc") === "oidc"
        ? { connectionId }
        : ("skip" as any),
  );

  const connection = $derived(connectionQuery.data as {
    _id: string;
    name?: string;
    status?: string;
    protocol?: "oidc" | "saml";
    config?: Record<string, any>;
  } | null);
  const protocol = $derived(connection?.protocol ?? "oidc");
  const domains = $derived((domainsQuery.data as Array<any> | undefined) ?? []);
  const primaryDomain = $derived(domains.find((domain) => domain.isPrimary) ?? domains[0] ?? null);
  const samlStoredConfig = $derived(
    ((connection?.config as any)?.protocols?.saml ?? null) as
      | {
          idp?: { metadataXml?: string };
          signAuthnRequests?: boolean;
          attributeMapping?: {
            subject?: string;
            email?: string;
            name?: string;
            firstName?: string;
            lastName?: string;
          };
        }
      | null,
  );
  const samlSetup = $derived(
    siteUrl
      ? {
          entityId: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/metadata`,
          acsUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/acs`,
          sloUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/saml/slo`,
        }
      : null,
  );
  const isActive = $derived(connection?.status === "active");

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "config", label: "Configuration" },
    { id: "domains", label: "Domains" },
    { id: "scim", label: "SCIM" },
  ];

  $effect(() => {
    if (protocol === "oidc") {
      oidcDiscoveryUrl = oidcConfigQuery.data?.discoveryUrl ?? oidcConfigQuery.data?.issuer ?? "";
      oidcClientId = oidcConfigQuery.data?.clientId ?? "";
    } else {
      samlMetadataXml = samlStoredConfig?.idp?.metadataXml ?? "";
      samlSignAuthnRequests = samlStoredConfig?.signAuthnRequests ?? false;
      samlSubjectAttr = samlStoredConfig?.attributeMapping?.subject ?? "";
      samlEmailAttr = samlStoredConfig?.attributeMapping?.email ?? "";
      samlNameAttr = samlStoredConfig?.attributeMapping?.name ?? "";
      samlFirstNameAttr = samlStoredConfig?.attributeMapping?.firstName ?? "";
      samlLastNameAttr = samlStoredConfig?.attributeMapping?.lastName ?? "";
    }
  });

  function setMessage(kind: "success" | "error", message: string | null) {
    if (kind === "success") { successMessage = message; errorMessage = null; }
    else { errorMessage = message; successMessage = null; }
  }

  function copyValue(value: string, field: string) {
    navigator.clipboard.writeText(value);
    copiedField = field;
    setTimeout(() => { copiedField = null; }, 2000);
  }

  async function handleValidate() {
    try {
      validationResult =
        protocol === "oidc"
          ? ((await client.query(api.auth.group.validateOidc, { connectionId })) as ValidationResult)
          : ((await client.query(api.auth.group.validateSaml, { connectionId })) as ValidationResult);
      setMessage("success", null);
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : "Validation failed.");
    }
  }

  async function handleSave() {
    isSaving = true;
    try {
      if (protocol === "oidc") {
        await client.mutation(api.auth.group.configureOidc, {
          connectionId,
          discoveryUrl: oidcDiscoveryUrl.trim() || undefined,
          clientId: oidcClientId.trim(),
          clientSecret: oidcClientSecret.trim() || undefined,
        });
      } else {
        await client.action(api.auth.group.configureSaml, {
          connectionId,
          metadataUrl: samlMetadataUrl.trim() || undefined,
          metadataXml: samlMetadataXml.trim() || undefined,
          signAuthnRequests: samlSignAuthnRequests,
          attributeMapping: {
            subject: samlSubjectAttr.trim() || undefined,
            email: samlEmailAttr.trim() || undefined,
            name: samlNameAttr.trim() || undefined,
            firstName: samlFirstNameAttr.trim() || undefined,
            lastName: samlLastNameAttr.trim() || undefined,
          },
        });
      }
      setMessage("success", "Configuration saved.");
      await handleValidate();
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : "Save failed.");
    } finally {
      isSaving = false;
    }
  }

  async function handleDelete() {
    isDeleting = true;
    try {
      await client.mutation(api.auth.group.deleteConnection, { connectionId });
      window.location.href = `/${groupId}/sso`;
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : "Delete failed.");
      isDeleting = false;
    }
  }

  async function handleAddDomain() {
    if (!newDomain.trim()) return;
    try {
      await client.mutation(api.auth.group.setDomains, {
        connectionId,
        domains: [
          ...domains.map((domain) => ({ domain: domain.domain, isPrimary: domain.isPrimary ?? false })),
          { domain: newDomain.trim(), isPrimary: domains.length === 0 },
        ],
      });
      newDomain = "";
      setMessage("success", "Domain added.");
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : "Failed to add domain.");
    }
  }

  async function handleRequestVerification(domain: string) {
    try {
      const result = await client.mutation(api.auth.group.requestDomainVerification, { connectionId, domain });
      verificationChallenge = { domain, recordName: result.challenge.recordName, token: result.challenge.recordValue };
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : "Verification failed.");
    }
  }

  async function handleConfirmVerification(domain: string) {
    try {
      await client.action(api.auth.group.confirmDomainVerification, { connectionId, domain });
      verificationChallenge = null;
      setMessage("success", `Verified ${domain}.`);
    } catch (error) {
      setMessage("error", error instanceof Error ? error.message : "Verification failed.");
    }
  }
</script>

{#if !connection}
  <p class="muted">Loading connection…</p>
{:else}
  <div class="col-span-full max-w-5xl mx-auto w-full px-8 py-10 flex flex-col gap-0 max-md:px-4 max-md:py-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-4 flex-wrap mb-8">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 font-label text-[0.75rem] text-gray-400">
          <a class="text-accent-500 hover:text-accent-600 no-underline font-semibold" href="/{groupId}/sso">SSO Connections</a>
          <span>/</span>
          <span class="text-gray-600">{connection.name ?? "Connection"}</span>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <h1 class="heading text-2xl m-0">{connection.name ?? "Connection"}</h1>
          <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 border border-indigo-500/20 text-indigo-600 bg-indigo-50">{protocol}</span>
          <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 border {isActive ? 'text-green-800 bg-green-50 border-green-300' : 'text-gray-500 bg-gray-100 border-gray-300'}">{connection.status ?? 'draft'}</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button class="button button--secondary button--compact" type="button" onclick={handleValidate}>Validate</button>
        <button class="font-label text-[0.75rem] font-semibold text-red-700 hover:text-red-900 bg-transparent border-0 cursor-pointer p-0" type="button" disabled={isDeleting} onclick={handleDelete}>{isDeleting ? 'Deleting…' : 'Delete connection'}</button>
      </div>
    </div>

    <!-- Messages -->
    {#if errorMessage}
      <div class="error-banner mb-4">{errorMessage}</div>
    {/if}
    {#if successMessage}
      <div class="mb-4 px-3 py-2 border border-green-300 bg-green-50 font-label text-[0.75rem] text-green-800">{successMessage}</div>
    {/if}

    <!-- Tab bar -->
    <div class="flex items-center gap-0 border-b border-gray-300 mb-6 overflow-x-auto">
      {#each tabs as tab (tab.id)}
        <button
          class="relative px-5 py-3 font-label text-[0.8125rem] font-semibold border-0 bg-transparent cursor-pointer transition-colors whitespace-nowrap
            {activeTab === tab.id ? 'text-accent-600' : 'text-gray-500 hover:text-gray-700'}"
          type="button"
          onclick={() => { activeTab = tab.id; }}
        >
          {tab.label}
          {#if activeTab === tab.id}
            <div class="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-500"></div>
            <div class="absolute bottom-0 left-0 w-[6px] h-[6px] bg-accent-500"></div>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Tab content -->
    {#if activeTab === "config"}
      <div class="flex flex-col gap-6">
        <!-- SP URLs callout -->
        <div class="relative border border-gray-300 bg-gray-100 p-5">
          <p class="m-0 mb-4 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">
            Service Provider Values
            <span class="ml-2 font-normal normal-case tracking-normal text-gray-400">— copy these into your Identity Provider</span>
          </p>
          <div class="flex flex-col gap-3">
            {#if protocol === 'saml' && samlSetup}
              {#each [
                ['Entity ID', samlSetup.entityId],
                ['ACS URL', samlSetup.acsUrl],
                ['SLO URL', samlSetup.sloUrl],
              ] as [label, value] (label)}
                <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                  <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400 w-20 shrink-0">{label}</span>
                  <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all min-w-0">{value}</code>
                  <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyValue(value, label)}>
                    {#if copiedField === label}
                      <Check size={14} class="text-green-600" />
                    {:else}
                      <Copy size={14} />
                    {/if}
                  </button>
                </div>
              {/each}
            {:else if protocol === 'oidc' && siteUrl}
              {@const redirectUri = `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connectionId}/oidc/callback`}
              <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400 w-24 shrink-0">Redirect URI</span>
                <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all min-w-0">{redirectUri}</code>
                <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyValue(redirectUri, 'redirect')}>
                  {#if copiedField === 'redirect'}
                    <Check size={14} class="text-green-600" />
                  {:else}
                    <Copy size={14} />
                  {/if}
                </button>
              </div>
            {/if}
          </div>
          <!-- Geometric accent -->
          <div class="absolute top-2 right-2 w-4 h-4 border border-gray-300/50"></div>
          <div class="absolute top-4 right-4 w-4 h-4 border border-gray-300/30"></div>
        </div>

        <!-- IdP Configuration form -->
        <div class="border border-gray-300 bg-white p-6 flex flex-col gap-5">
          <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Identity Provider Configuration</p>

          {#if protocol === 'oidc'}
            <label class="flex flex-col gap-1.5">
              <span class="font-label text-xs font-semibold text-gray-700">Discovery URL</span>
              <input bind:value={oidcDiscoveryUrl} class="input" type="url" placeholder="https://idp.example.com/.well-known/openid-configuration" />
            </label>
            <div class="grid gap-5 md:grid-cols-2">
              <label class="flex flex-col gap-1.5">
                <span class="font-label text-xs font-semibold text-gray-700">Client ID</span>
                <input bind:value={oidcClientId} class="input" type="text" placeholder="Client ID" />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="font-label text-xs font-semibold text-gray-700">Client Secret</span>
                <input bind:value={oidcClientSecret} class="input" type="password" placeholder="Leave blank to keep current" />
              </label>
            </div>
          {:else}
            <div class="grid gap-5 md:grid-cols-2">
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="font-label text-xs font-semibold text-gray-700">Metadata URL</span>
                <input bind:value={samlMetadataUrl} class="input" type="url" placeholder="https://idp.example.com/.../metadata" />
              </label>
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="font-label text-xs font-semibold text-gray-700">Metadata XML</span>
                <textarea bind:value={samlMetadataXml} class="input resize-y min-h-28 font-mono text-[0.72rem] py-2" rows="5"></textarea>
              </label>
            </div>

            <div class="border-t border-gray-200 pt-5">
              <p class="m-0 mb-4 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-gray-500">Attribute Mapping</p>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-gray-700">Subject</span>
                  <input bind:value={samlSubjectAttr} class="input" type="text" placeholder="NameID fallback" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-gray-700">Email</span>
                  <input bind:value={samlEmailAttr} class="input" type="text" placeholder="email or claim URI" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-gray-700">Display Name</span>
                  <input bind:value={samlNameAttr} class="input" type="text" placeholder="displayName" />
                </label>
                <label class="flex flex-col gap-1.5">
                  <span class="font-label text-xs font-semibold text-gray-700">First Name</span>
                  <input bind:value={samlFirstNameAttr} class="input" type="text" placeholder="givenName" />
                </label>
                <label class="flex flex-col gap-1.5 md:col-span-2">
                  <span class="font-label text-xs font-semibold text-gray-700">Last Name</span>
                  <input bind:value={samlLastNameAttr} class="input" type="text" placeholder="surname" />
                </label>
              </div>
            </div>

            <label class="flex items-center gap-2.5 pt-1">
              <input bind:checked={samlSignAuthnRequests} type="checkbox" class="w-4 h-4 accent-accent-500" />
              <span class="font-label text-[0.8125rem] text-gray-700">Sign AuthnRequests</span>
            </label>
          {/if}

          <div class="flex items-center gap-3 pt-2 border-t border-gray-200">
            <button class="button button--accent" type="button" disabled={isSaving} onclick={handleSave}>{isSaving ? 'Saving…' : 'Save configuration'}</button>
          </div>
        </div>

        <!-- Validation results -->
        {#if validationResult}
          <div class="border border-gray-300 bg-white p-5 flex flex-col gap-0">
            <p class="m-0 mb-3 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.12em] {validationResult.ok ? 'text-green-700' : 'text-accent-600'}">
              Validation {validationResult.ok ? 'Passed' : 'Issues Found'}
            </p>
            {#each validationResult.checks as check (check.name)}
              <div class="flex items-start justify-between gap-4 py-3 border-t border-gray-200">
                <div class="flex items-start gap-3 min-w-0">
                  {#if check.ok}
                    <Check size={16} weight="bold" class="text-green-600 mt-0.5 shrink-0" />
                  {:else}
                    <Warning size={16} weight="bold" class="text-accent-500 mt-0.5 shrink-0" />
                  {/if}
                  <div class="min-w-0">
                    <p class="m-0 font-label text-[0.8125rem] font-semibold text-gray-900">{check.name}</p>
                    {#if check.message}<p class="m-0 mt-1 font-label text-[0.75rem] text-gray-500">{check.message}</p>{/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === "domains"}
      <div class="flex flex-col gap-4">
        <!-- Domain summary -->
        <div class="flex items-center gap-4 mb-2">
          <p class="m-0 font-label text-[0.8125rem] text-gray-500">
            {domains.length} domain{domains.length !== 1 ? 's' : ''} configured
            {#if domains.length > 0}
              — {domains.filter((d) => Boolean(d.verifiedAt)).length} verified
            {/if}
          </p>
        </div>

        <!-- Domain list -->
        {#if domains.length > 0}
          <div class="border border-gray-300 bg-white">
            {#each domains as domain, i (domain.domain)}
              <div class="flex items-center justify-between gap-4 px-5 py-4 {i > 0 ? 'border-t border-gray-200' : ''}">
                <div class="flex items-center gap-3 flex-wrap min-w-0">
                  <span class="font-label text-[0.9375rem] font-semibold text-gray-900">{domain.domain}</span>
                  {#if domain.isPrimary}
                    <span class="font-label text-[0.5625rem] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 border border-slate-400/30 text-slate-600 bg-slate-400/10">Primary</span>
                  {/if}
                  <span class="font-label text-[0.5625rem] font-semibold uppercase tracking-[0.12em] px-2 py-0.5 border {domain.verifiedAt ? 'text-green-800 bg-green-50 border-green-300' : 'text-amber-800 bg-amber-50 border-amber-300'}">
                    {domain.verifiedAt ? 'Verified' : 'Pending'}
                  </span>
                </div>
                {#if !domain.verifiedAt}
                  <button class="button button--secondary button--compact" type="button" onclick={() => handleRequestVerification(domain.domain)}>Verify</button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Verification challenge -->
        {#if verificationChallenge}
          <div class="border border-indigo-500/20 bg-indigo-50/50 p-5 flex flex-col gap-4">
            <p class="m-0 font-label text-[0.75rem] font-semibold text-indigo-700">
              Add this TXT record to verify <span class="text-indigo-900">{verificationChallenge.domain}</span>
            </p>
            <div class="flex flex-col gap-3">
              {#each [
                ['TXT Name', verificationChallenge.recordName],
                ['TXT Value', verificationChallenge.token],
              ] as [label, value] (label)}
                <div class="flex items-center gap-3 min-w-0 max-md:flex-col max-md:items-start max-md:gap-1">
                  <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-indigo-500 w-20 shrink-0">{label}</span>
                  <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all min-w-0 bg-white/60 px-2 py-1 border border-indigo-500/10">{value}</code>
                  <button class="button button--secondary button--compact shrink-0" type="button" onclick={() => copyValue(value, label)}>
                    {#if copiedField === label}
                      <Check size={14} class="text-green-600" />
                    {:else}
                      <Copy size={14} />
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
            <button class="button button--accent button--compact self-start" type="button" onclick={() => handleConfirmVerification(verificationChallenge.domain)}>Confirm verification</button>
          </div>
        {/if}

        <!-- Add domain -->
        <div class="flex gap-3 items-center">
          <input bind:value={newDomain} class="input flex-1" type="text" placeholder="Add a domain (e.g. acme.com)" />
          <button class="button button--secondary" type="button" disabled={!newDomain.trim()} onclick={handleAddDomain}>Add domain</button>
        </div>
      </div>

    {:else if activeTab === "scim"}
      <ScimSection {client} {connectionId} />
    {/if}
  </div>
{/if}
