<script lang="ts">
import type { ConvexClient } from "convex/browser";
import { useQuery } from "convex-svelte";
import { api } from "$convex/_generated/api.js";
import Copy from "phosphor-svelte/lib/Copy";

type ValidationResult = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
};
type DomainRecord = { domain: string; isPrimary?: boolean; verifiedAt?: number };
type SamlStoredConfig = {
  idp?: { metadataXml?: string; metadataUrl?: string; entityId?: string };
  request?: { signAuthnRequests?: boolean };
  profile?: {
    mapping?: {
      subject?: string;
      email?: string;
      name?: string;
      firstName?: string;
      lastName?: string;
    };
  };
};
type ConnectionListItem = {
  _id: string;
  name?: string;
  status?: string;
  protocol?: "oidc" | "saml";
};
type OidcConfigDraft = {
  discoveryUrl?: string;
  issuer?: string;
  clientId?: string;
  hasClientSecret?: boolean;
};

let { client, connection, siteUrl } = $props<{
  client: ConvexClient;
  connection: ConnectionListItem;
  siteUrl: string | null;
}>();

let isLoading = $state(false);
let isEditingConfig = $state(false);
let isSavingConfig = $state(false);
let errorMessage = $state<string | null>(null);
let successMessage = $state<string | null>(null);
let newDomain = $state("");
let metadataCopyState = $state<"idle" | "copying" | "copied" | "error">("idle");
let verificationChallenge = $state<{ domain: string; recordName: string; token: string } | null>(null);
let validationResult = $state<ValidationResult | null>(null);

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

const connectionQuery = useQuery(api.auth.group.getConnection, () => ({
  connectionId: connection._id,
}));
const domainsQuery = useQuery(api.auth.group.listDomains, () => ({
  connectionId: connection._id,
}));
const statusQuery = useQuery(api.auth.group.getConnectionStatus, () => ({
  connectionId: connection._id,
}));
const oidcConfigQuery = useQuery(
  api.auth.group.getOidc,
  () =>
    (connectionQuery.data?.protocol ?? connection.protocol) === "oidc"
      ? { connectionId: connection._id }
      : "skip",
);

const connectionDoc = $derived(connectionQuery.data ?? connection);
const protocol = $derived(connectionDoc?.protocol ?? "oidc");
const domainList = $derived.by(() => {
  return domainsQuery.data ?? [];
});
const primaryDomain = $derived(domainList.find((domain) => domain.isPrimary) ?? null);
const verifiedDomainCount = $derived(domainList.filter((domain) => Boolean(domain.verifiedAt)).length);
const samlStoredConfig = $derived(readSamlStoredConfig(connectionQuery.data?.config));
const samlSetup = $derived(
  siteUrl
    ? {
        entityId: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connection._id}/saml/metadata`,
        metadataUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connection._id}/saml/metadata`,
        acsUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connection._id}/saml/acs`,
        sloUrl: `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connection._id}/saml/slo`,
      }
    : null,
);
const currentOidcConfig = $derived(readOidcConfig(oidcConfigQuery.data));

function resetMessages() {
  errorMessage = null;
  successMessage = null;
  validationResult = null;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function readSamlStoredConfig(config: unknown): SamlStoredConfig | null {
  if (!config || typeof config !== "object") return null;
  const protocols = "protocols" in config ? config.protocols : undefined;
  if (!protocols || typeof protocols !== "object") return null;
  const saml = "saml" in protocols ? protocols.saml : undefined;
  if (!saml || typeof saml !== "object") return null;
  const record = saml as Record<string, unknown>;
  const idp =
    typeof record.idp === "object" && record.idp !== null
      ? (record.idp as Record<string, unknown>)
      : undefined;
  const profile =
    typeof record.profile === "object" && record.profile !== null
      ? (record.profile as Record<string, unknown>)
      : undefined;
  const attributeMapping =
    typeof profile?.mapping === "object" && profile.mapping !== null
      ? (profile.mapping as Record<string, unknown>)
      : undefined;
  return {
    idp:
      idp !== undefined
        ? {
            metadataUrl:
              typeof idp.metadataUrl === "string" ? idp.metadataUrl : undefined,
            metadataXml:
              typeof idp.metadataXml === "string" ? idp.metadataXml : undefined,
            entityId: typeof idp.entityId === "string" ? idp.entityId : undefined,
          }
        : undefined,
    request: {
      signAuthnRequests:
      typeof (record.request as { signAuthnRequests?: unknown } | undefined)
        ?.signAuthnRequests === "boolean"
        ? ((record.request as { signAuthnRequests: boolean }).signAuthnRequests)
        : undefined,
    },
    profile:
      attributeMapping !== undefined
        ? {
            mapping: {
              subject:
                typeof attributeMapping.subject === "string"
                  ? attributeMapping.subject
                  : undefined,
              email:
                typeof attributeMapping.email === "string"
                  ? attributeMapping.email
                  : undefined,
              name:
                typeof attributeMapping.name === "string"
                  ? attributeMapping.name
                  : undefined,
              firstName:
                typeof attributeMapping.firstName === "string"
                  ? attributeMapping.firstName
                  : undefined,
              lastName:
                typeof attributeMapping.lastName === "string"
                  ? attributeMapping.lastName
                  : undefined,
            },
          }
        : undefined,
  };
}

function readOidcConfig(config: unknown): OidcConfigDraft | null {
  if (!config || typeof config !== "object") return null;
  const record = config as Record<string, unknown>;
  const discovery =
    typeof record.discovery === "object" && record.discovery !== null
      ? (record.discovery as Record<string, unknown>)
      : undefined;
  const client =
    typeof record.client === "object" && record.client !== null
      ? (record.client as Record<string, unknown>)
      : undefined;
  return {
    discoveryUrl:
      typeof discovery?.discoveryUrl === "string"
        ? discovery.discoveryUrl
        : undefined,
    issuer: typeof discovery?.issuer === "string" ? discovery.issuer : undefined,
    clientId: typeof client?.id === "string" ? client.id : undefined,
    hasClientSecret:
      typeof record.hasClientSecret === "boolean"
        ? record.hasClientSecret
        : undefined,
  };
}

function openConfigEditor() {
  resetMessages();
  if (protocol === "oidc") {
    oidcDiscoveryUrl =
      currentOidcConfig?.discoveryUrl ?? currentOidcConfig?.issuer ?? "";
    oidcClientId = currentOidcConfig?.clientId ?? "";
    oidcClientSecret = "";
  } else {
    samlMetadataUrl = samlStoredConfig?.idp?.metadataUrl ?? "";
    samlMetadataXml = samlStoredConfig?.idp?.metadataXml ?? "";
    samlSignAuthnRequests = samlStoredConfig?.request?.signAuthnRequests ?? false;
    samlSubjectAttr = samlStoredConfig?.profile?.mapping?.subject ?? "";
    samlEmailAttr = samlStoredConfig?.profile?.mapping?.email ?? "";
    samlNameAttr = samlStoredConfig?.profile?.mapping?.name ?? "";
    samlFirstNameAttr = samlStoredConfig?.profile?.mapping?.firstName ?? "";
    samlLastNameAttr = samlStoredConfig?.profile?.mapping?.lastName ?? "";
  }
  isEditingConfig = true;
}

function closeConfigEditor() {
  isEditingConfig = false;
  resetMessages();
}

async function handleDelete() {
  isLoading = true;
  resetMessages();
  try {
    await client.mutation(api.auth.group.deleteConnection, {
      connectionId: connection._id,
    });
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : "Failed to delete connection";
  } finally {
    isLoading = false;
  }
}

async function handleAddDomain() {
  if (!newDomain.trim()) return;
  isLoading = true;
  resetMessages();
  try {
    const existing = domainList.map((domain) => ({
      domain: domain.domain,
      isPrimary: domain.isPrimary ?? false,
    }));
    await client.mutation(api.auth.group.setDomains, {
      connectionId: connection._id,
      domains: [
        ...existing,
        { domain: newDomain.trim(), isPrimary: existing.length === 0 },
      ],
    });
    newDomain = "";
    successMessage = "Domain added.";
  } catch (e: unknown) {
    errorMessage = e instanceof Error ? e.message : "Failed to add domain";
  } finally {
    isLoading = false;
  }
}

async function handleRequestVerification(domain: string) {
  isLoading = true;
  resetMessages();
  try {
    const result = await client.mutation(api.auth.group.requestDomainVerification, {
      connectionId: connection._id,
      domain,
    });
    verificationChallenge = {
      domain,
      recordName: result.challenge.recordName,
      token: result.challenge.recordValue,
    };
  } catch (e: unknown) {
    errorMessage =
      e instanceof Error ? e.message : "Failed to request domain verification";
  } finally {
    isLoading = false;
  }
}

async function handleConfirmVerification(domain: string) {
  isLoading = true;
  resetMessages();
  try {
    await client.action(api.auth.group.confirmDomainVerification, {
      connectionId: connection._id,
      domain,
    });
    verificationChallenge = null;
    successMessage = `Verified ${domain}.`;
  } catch (e: unknown) {
    errorMessage =
      e instanceof Error
        ? e.message
        : "Verification failed. Check the DNS TXT record and try again.";
  } finally {
    isLoading = false;
  }
}

async function handleCopyMetadataXml() {
  metadataCopyState = "copying";
  resetMessages();
  try {
    const metadataXml = await client.query(api.auth.group.metadata, {
      connectionId: connection._id,
    });
    await navigator.clipboard.writeText(metadataXml);
    metadataCopyState = "copied";
  } catch (e: unknown) {
    metadataCopyState = "error";
    errorMessage =
      e instanceof Error ? e.message : "Failed to copy metadata XML";
  }
}

async function handleValidate() {
  resetMessages();
  try {
    validationResult =
      protocol === "oidc"
        ? await client.query(api.auth.group.validateOidc, {
            connectionId: connection._id,
          })
        : await client.query(api.auth.group.validateSaml, {
            connectionId: connection._id,
          });
  } catch (e: unknown) {
    errorMessage =
      e instanceof Error ? e.message : "Failed to validate configuration";
  }
}

async function handleSaveConfig() {
  isSavingConfig = true;
  resetMessages();
  try {
    if (protocol === "oidc") {
      await client.mutation(api.auth.group.configureOidc, {
        connectionId: connection._id,
        discovery: {
          discoveryUrl: oidcDiscoveryUrl.trim() || undefined,
        },
        client: {
          id: oidcClientId.trim(),
          secret: oidcClientSecret.trim() || undefined,
        },
      });
    } else {
      const existingMetadataXml = samlStoredConfig?.idp?.metadataXml;
      await client.action(api.auth.group.configureSaml, {
        connectionId: connection._id,
        metadata: {
          url: samlMetadataUrl.trim() || undefined,
          xml: samlMetadataXml.trim() || existingMetadataXml || undefined,
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
    }
    successMessage = `${protocol.toUpperCase()} configuration saved.`;
    isEditingConfig = false;
    await handleValidate();
  } catch (e: unknown) {
    errorMessage =
      e instanceof Error ? e.message : `Failed to save ${protocol.toUpperCase()} configuration`;
  } finally {
    isSavingConfig = false;
  }
}
</script>

<div class="border border-gray-300 bg-white">
  <div class="p-5 border-b border-gray-300 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
    <div class="flex flex-col gap-2 min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="m-0 font-sans text-2xl font-semibold text-gray-900 leading-none">
          {connectionDoc?.name ?? "SSO Connection"}
        </h3>
        <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.08em] px-2 py-1 border text-gray-600 bg-gray-100 border-gray-300">
          {protocol}
        </span>
        <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.08em] px-2 py-1 border {connectionDoc?.status === 'active' ? 'text-green-800 bg-green-50 border-green-300' : 'text-gray-600 bg-gray-100 border-gray-300'}">
          {connectionDoc?.status ?? "draft"}
        </span>
      </div>
      <p class="m-0 font-label text-[0.8125rem] text-gray-500">
        {protocol === "saml"
          ? "SAML connection with hosted ACS / metadata endpoints and optional attribute mapping."
          : "OIDC connection using your provider discovery document and client credentials."}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-1.5 shrink-0">
      <button class="button button--secondary button--compact" type="button" onclick={handleValidate}>
        Validate
      </button>
      <button class="button button--accent button--compact" type="button" onclick={openConfigEditor}>
        {isEditingConfig ? "Editing…" : protocol === "saml" ? "Configure SAML" : "Configure OIDC"}
      </button>
      <button class="button button--secondary button--compact" disabled={isLoading} onclick={handleDelete}>
        Delete
      </button>
    </div>
  </div>

  <div class="p-5 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,1fr)]">
    <div class="flex flex-col gap-4 min-w-0">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="border border-gray-300 bg-gray-50 p-3">
          <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">Primary domain</p>
          <p class="mt-2 mb-0 font-sans text-lg font-semibold text-gray-900 break-all">
            {primaryDomain?.domain ?? "Not configured"}
          </p>
        </div>
        <div class="border border-gray-300 bg-gray-50 p-3">
          <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">Verified domains</p>
          <p class="mt-2 mb-0 font-sans text-lg font-semibold text-gray-900">{verifiedDomainCount}/{domainList.length || 0}</p>
        </div>
        <div class="border border-gray-300 bg-gray-50 p-3">
          <p class="m-0 font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">Connection ID</p>
          <p class="mt-2 mb-0 font-mono text-[0.72rem] text-gray-800 break-all">{connection._id}</p>
        </div>
      </div>

      <div class="border border-gray-300 bg-gray-100 p-4 flex flex-col gap-3 min-w-0">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p class="m-0 font-label text-xs font-semibold text-gray-700">
              {protocol === "saml" ? "Connection setup values" : "OIDC callback setup"}
            </p>
            <p class="m-0 mt-1 font-label text-[0.72rem] text-gray-500">
              {protocol === "saml"
                ? "These are the app-side values you give to your IdP admin, plus the runtime metadata document after activation."
                : "Use this redirect URI and keep your discovery URL / client credentials up to date here."}
            </p>
          </div>
          {#if protocol === "saml"}
            <button class="button button--secondary button--compact" type="button" disabled={metadataCopyState === "copying"} onclick={handleCopyMetadataXml}>
              {metadataCopyState === "copying" ? "Copying metadata..." : metadataCopyState === "copied" ? "Metadata copied" : "Copy metadata XML"}
            </button>
          {/if}
        </div>

        {#if protocol === "saml" && samlSetup}
          {#each [
            { label: "Entity ID", value: samlSetup.entityId },
            { label: "ACS URL", value: samlSetup.acsUrl },
            { label: "SLO URL", value: samlSetup.sloUrl },
            { label: "Runtime metadata URL", value: samlSetup.metadataUrl },
          ] as item (item.label)}
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">{item.label}</span>
              <div class="flex items-center gap-1.5 max-md:flex-col max-md:items-stretch min-w-0">
                <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all bg-transparent border-0 p-0 min-w-0">{item.value}</code>
                <button class="button button--secondary button--compact max-md:self-start" type="button" onclick={() => copyToClipboard(item.value)}>Copy</button>
              </div>
            </div>
          {/each}
        {:else if protocol === "oidc"}
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">Redirect URI</span>
            <div class="flex items-center gap-1.5 max-md:flex-col max-md:items-stretch min-w-0">
              <code class="flex-1 font-mono text-[0.72rem] text-gray-800 break-all bg-transparent border-0 p-0 min-w-0">{siteUrl ? `${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connection._id}/oidc/callback` : "Set CONVEX_SITE_URL to generate the redirect URI."}</code>
              {#if siteUrl}
                <button class="button button--secondary button--compact max-md:self-start" type="button" onclick={() => copyToClipboard(`${siteUrl.replace(/\/$/, "")}/api/auth/connections/${connection._id}/oidc/callback`)}>Copy</button>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      {#if isEditingConfig}
        <div class="border border-gray-300 bg-white p-4 flex flex-col gap-3">
          <div>
            <p class="m-0 font-label text-xs font-semibold text-gray-700">
              {protocol === "saml" ? "Update SAML configuration" : "Update OIDC configuration"}
            </p>
            <p class="m-0 mt-1 font-label text-[0.72rem] text-gray-500">
              {protocol === "saml"
                ? "Update IdP metadata and attribute mapping so sign-in produces the right user profile fields."
                : "Rotate client credentials or switch discovery settings without recreating the connection."}
            </p>
          </div>

          {#if protocol === "oidc"}
            <label class="flex flex-col gap-0.5">
              <span class="font-label text-xs font-semibold text-gray-700">Discovery URL or issuer</span>
              <input bind:value={oidcDiscoveryUrl} class="input input--compact" type="url" placeholder="https://idp.example.com/.well-known/openid-configuration" />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="font-label text-xs font-semibold text-gray-700">Client ID</span>
              <input bind:value={oidcClientId} class="input input--compact" type="text" placeholder="Client ID" />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="font-label text-xs font-semibold text-gray-700">Client secret</span>
              <input bind:value={oidcClientSecret} class="input input--compact" type="password" placeholder={currentOidcConfig?.hasClientSecret ? "Leave blank to keep the stored secret" : "Client secret"} />
            </label>
          {:else}
            <label class="flex flex-col gap-0.5">
              <span class="font-label text-xs font-semibold text-gray-700">Metadata URL</span>
              <input bind:value={samlMetadataUrl} class="input input--compact" type="url" placeholder="https://idp.example.com/.../metadata" />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="font-label text-xs font-semibold text-gray-700">Metadata XML</span>
              <textarea bind:value={samlMetadataXml} class="input input--compact resize-y min-h-24 font-mono text-[0.72rem]" rows="5" placeholder="<EntityDescriptor ...>"></textarea>
            </label>

            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-0.5">
                <span class="font-label text-xs font-semibold text-gray-700">Subject attribute</span>
                <input bind:value={samlSubjectAttr} class="input input--compact" type="text" placeholder="NameID fallback when blank" />
              </label>
              <label class="flex flex-col gap-0.5">
                <span class="font-label text-xs font-semibold text-gray-700">Email attribute</span>
                <input bind:value={samlEmailAttr} class="input input--compact" type="text" placeholder="email or claim URI" />
              </label>
              <label class="flex flex-col gap-0.5">
                <span class="font-label text-xs font-semibold text-gray-700">Display name attribute</span>
                <input bind:value={samlNameAttr} class="input input--compact" type="text" placeholder="displayName" />
              </label>
              <label class="flex flex-col gap-0.5">
                <span class="font-label text-xs font-semibold text-gray-700">First name attribute</span>
                <input bind:value={samlFirstNameAttr} class="input input--compact" type="text" placeholder="givenName" />
              </label>
              <label class="flex flex-col gap-0.5 sm:col-span-2">
                <span class="font-label text-xs font-semibold text-gray-700">Last name attribute</span>
                <input bind:value={samlLastNameAttr} class="input input--compact" type="text" placeholder="surname" />
              </label>
            </div>

            <label class="flex items-center gap-2">
              <input bind:checked={samlSignAuthnRequests} type="checkbox" />
              <span class="font-label text-xs font-semibold text-gray-700">Sign AuthnRequests</span>
            </label>
          {/if}

          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <button class="button button--accent button--compact" type="button" disabled={isSavingConfig} onclick={handleSaveConfig}>
              {isSavingConfig ? "Saving..." : protocol === "saml" ? "Save SAML config" : "Save OIDC config"}
            </button>
            <button class="button button--secondary button--compact" type="button" onclick={closeConfigEditor}>
              Cancel
            </button>
          </div>
        </div>
      {/if}

      {#if validationResult}
        <div class="border border-gray-300 bg-white p-4 flex flex-col gap-2.5">
          <div class="flex items-center gap-2">
            <p class="m-0 font-label text-xs font-semibold text-gray-700">Validation</p>
            <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.08em] px-2 py-1 border {validationResult.ok ? 'text-green-800 bg-green-50 border-green-300' : 'text-amber-800 bg-amber-50 border-amber-300'}">
              {validationResult.ok ? "Ready" : "Needs attention"}
            </span>
          </div>
          <div class="grid gap-2">
            {#each validationResult.checks as check (check.name)}
              <div class="border border-gray-300 bg-gray-50 p-3">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">{check.name}</span>
                  <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.08em] px-2 py-1 border {check.ok ? 'text-green-800 bg-green-50 border-green-300' : 'text-red-700 bg-red-50 border-red-300'}">
                    {check.ok ? "OK" : "Issue"}
                  </span>
                </div>
                {#if check.message}
                  <p class="m-0 mt-2 font-label text-[0.72rem] text-gray-600">{check.message}</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if errorMessage}
        <p class="error-banner">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="m-0 px-3 py-2 border border-green-300 bg-green-50 font-label text-[0.75rem] text-green-800">{successMessage}</p>
      {/if}
    </div>

    <div class="flex flex-col gap-4">
      <div class="border border-gray-300 bg-white p-4 flex flex-col gap-3">
        <div>
          <p class="m-0 font-label text-xs font-semibold text-gray-700">Domain routing</p>
          <p class="m-0 mt-1 font-label text-[0.72rem] text-gray-500">
            Verified domains control which users resolve into this connection from the shared email-first sign-in flow.
          </p>
        </div>

        {#if domainList.length > 0}
          <div class="flex flex-col gap-2.5">
            {#each domainList as domain (domain.domain)}
              <div class="border border-gray-300 bg-gray-50 p-3 flex flex-col gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-label text-sm font-semibold text-gray-900">{domain.domain}</span>
                  {#if domain.isPrimary}
                    <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.08em] px-2 py-1 border text-gray-600 bg-white border-gray-300">Primary</span>
                  {/if}
                  <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.08em] px-2 py-1 border {domain.verifiedAt ? 'text-green-800 bg-green-50 border-green-300' : 'text-amber-800 bg-amber-50 border-amber-300'}">
                    {domain.verifiedAt ? "Verified" : "Needs verification"}
                  </span>
                </div>
                {#if !domain.verifiedAt}
                  <button class="button button--secondary button--compact self-start" disabled={isLoading} onclick={() => handleRequestVerification(domain.domain)}>
                    Verify domain
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="m-0 font-label text-[0.75rem] text-gray-500">No domains attached yet.</p>
        {/if}

        {#if verificationChallenge}
          {@const challenge = verificationChallenge}
          <div class="border border-gray-300 bg-gray-100 p-3 flex flex-col gap-2.5">
            <p class="m-0 font-label text-xs font-semibold text-gray-700">
              Verify {challenge.domain}
            </p>
            <div class="flex flex-col gap-0.5">
              <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">TXT name</span>
              <div class="flex items-center gap-1.5">
                <input class="input input--compact flex-1 font-mono text-xs" value={challenge.recordName} readonly />
                <button class="button button--secondary button--compact" type="button" onclick={() => copyToClipboard(challenge.recordName)}>
                  Copy
                </button>
              </div>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">TXT value</span>
              <div class="flex items-center gap-1.5">
                <input class="input input--compact flex-1 font-mono text-xs" value={challenge.token} readonly />
                <button class="button button--secondary button--compact" type="button" onclick={() => copyToClipboard(challenge.token)}>
                  Copy
                </button>
              </div>
            </div>
            <button class="button button--accent button--compact self-start" disabled={isLoading} onclick={() => handleConfirmVerification(challenge.domain)}>
              {isLoading ? "Checking..." : "Confirm verification"}
            </button>
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500">Add another domain</span>
          <div class="flex gap-1.5 items-center">
            <input bind:value={newDomain} class="input input--compact flex-1" type="text" placeholder="acme.com" />
            <button class="button button--secondary button--compact" disabled={isLoading || !newDomain.trim()} onclick={handleAddDomain}>
              Add domain
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
