<script lang="ts">
  import { getConvexClient } from "convex-svelte";
  import { getContext } from "svelte";
  import { toast } from "svelte-sonner";
  import { api } from "$convex/_generated/api.js";
  import { errorText } from "$lib/errors";
  import type { AppContext } from "$lib/app";

  const app = getContext<AppContext>("app");
  const client = getConvexClient();

  let name = $state("");
  let redirectUris = $state("http://localhost:8787/callback");
  let isSubmitting = $state(false);
  let result = $state<{ clientId: string; clientSecret?: string } | null>(null);

  async function register() {
    isSubmitting = true;
    try {
      result = await client.mutation(api.oauth.registerClient, {
        name: name.trim(),
        redirectUris: redirectUris
          .split(/[\n,]/)
          .map((u) => u.trim())
          .filter(Boolean),
      });
    } catch (e: unknown) {
      toast.error(errorText(e, "Failed to register client."));
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="col-span-full flex min-h-dvh w-full justify-center p-6 max-md:p-4">
  <div class="flex w-full max-w-lg flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h1 class="heading text-2xl m-0">OAuth clients</h1>
      <p class="muted m-0">
        Register an MCP client to access this workspace over the Model Context Protocol.
      </p>
    </header>

    {#if !app.isAuthenticated}
      <p class="muted">Sign in to register an OAuth client.</p>
    {:else if result}
      <div class="panel flex flex-col gap-3 p-4">
        <div class="callout callout--success">
          Client registered. Copy the secret now — it is shown only once.
        </div>
        <div class="flex flex-col gap-1">
          <span class="label">Client ID</span>
          <code class="code-block">{result.clientId}</code>
        </div>
        <div class="flex flex-col gap-1">
          <span class="label">Client secret</span>
          <code class="code-block">{result.clientSecret}</code>
        </div>
        <button
          class="button button--secondary self-start"
          onclick={() => {
            result = null;
            name = "";
          }}
        >
          Register another
        </button>
      </div>
    {:else}
      <form class="panel flex flex-col gap-3 p-4" onsubmit={(e) => { e.preventDefault(); register(); }}>
        <label class="flex flex-col gap-1">
          <span class="label">Name</span>
          <input class="input" bind:value={name} placeholder="My MCP client" maxlength="80" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="label">Redirect URIs (one per line)</span>
          <textarea
            class="input min-h-20"
            bind:value={redirectUris}
            placeholder="http://localhost:8787/callback"
          ></textarea>
        </label>
        <p class="muted m-0 text-sm">
          The client is granted this workspace's capabilities; tools are gated per
          grant and further limited by the acting user's role.
        </p>
        <button
          class="button button--accent self-start"
          disabled={isSubmitting || !name.trim()}
          type="submit"
        >
          {isSubmitting ? "Registering..." : "Register client"}
        </button>
      </form>
    {/if}
  </div>
</div>
