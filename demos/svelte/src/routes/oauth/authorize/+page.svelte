<script lang="ts">
  import { page } from "$app/state";
  import { getConvexClient } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$convex/_generated/api.js";
  import { errorText } from "$lib/errors";
  import { getContext } from "svelte";
  import type { AppContext } from "$lib/app";
  import AuthModal from "$lib/components/AuthModal.svelte";

  const app = getContext<AppContext>("app");

  const client = getConvexClient();
  const params = page.url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const scope = params.get("scope") ?? "";
  const oauthState = params.get("state");
  const codeChallenge = params.get("code_challenge") ?? "";
  const resource = params.get("resource");

  const scopeList = $derived(scope.split(" ").filter(Boolean));
  const invalid = $derived(!clientId || !redirectUri || !codeChallenge);

  let isSubmitting = $state(false);

  async function approve() {
    isSubmitting = true;
    try {
      const result = await client.mutation(api.oauth.authorize, {
        clientId,
        redirectUri,
        scope,
        state: oauthState ?? undefined,
        codeChallenge,
        resource: resource ?? undefined,
      });
      window.location.href = result.redirect;
    } catch (e: unknown) {
      toast.error(errorText(e, "Failed to authorize."));
      isSubmitting = false;
    }
  }

  function deny() {
    if (!redirectUri) return;
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (oauthState) url.searchParams.set("state", oauthState);
    window.location.href = url.toString();
  }
</script>

<div class="col-span-full flex min-h-dvh w-full items-center justify-center p-4">
  {#if !app.isAuthenticated}
    <div class="flex w-full max-w-80 flex-col gap-3">
      <p class="muted text-center">Sign in to authorize this application.</p>
      <AuthModal authProviders={app.authProviders} />
    </div>
  {:else if invalid}
    <div class="panel panel--raised w-full max-w-md p-5">
      <h2 class="heading text-xl m-0">Invalid authorization request</h2>
      <p class="muted m-0 mt-1">
        This page expects an OAuth authorization request with <span class="font-mono">client_id</span>,
        <span class="font-mono">redirect_uri</span>, and <span class="font-mono">code_challenge</span>.
        Start the flow from your MCP client.
      </p>
    </div>
  {:else}
    <div
      class="panel panel--raised flex w-full max-w-md flex-col gap-3 border-t-[3px] border-t-brand-red p-5 max-md:p-4"
    >
      <h2 class="heading text-xl m-0">Authorize access</h2>
      <p class="muted m-0">
        <span class="font-mono text-content-primary">{clientId}</span> is requesting access to your
        workspace.
      </p>

      {#if scopeList.length > 0}
        <div class="flex flex-col gap-1.5">
          <span class="label">Requested access</span>
          {#each scopeList as scopeName (scopeName)}
            <div class="callout callout--hint text-[0.8125rem]">{scopeName}</div>
          {/each}
        </div>
      {/if}

      {#if resource}
        <p class="muted m-0 text-[0.75rem]">Resource: <span class="font-mono">{resource}</span></p>
      {/if}

      <div class="flex gap-2">
        <button
          class="button button--accent button--block"
          disabled={isSubmitting}
          onclick={approve}
        >
          {isSubmitting ? "Authorizing..." : "Authorize"}
        </button>
        <button class="button button--secondary" disabled={isSubmitting} onclick={deny}>Deny</button>
      </div>
    </div>
  {/if}
</div>
