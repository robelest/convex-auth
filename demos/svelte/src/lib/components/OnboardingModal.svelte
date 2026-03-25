<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";

  let { client } = $props<{
    client: ConvexClient;
  }>();

  let errorMessage: string | null = $state(null);
  let isSubmitting: boolean = $state(false);
  let name: string = $state("");

  async function handleCreate() {
    if (name.trim().length < 3) {
      errorMessage = "Name must be at least 3 characters.";
      return;
    }

    isSubmitting = true;
    errorMessage = null;

    try {
      const result = await client.mutation(api.demo.createWorkspace, { name });
      if ("ok" in result && !result.ok && "message" in result) {
        errorMessage = (result as any).message;
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "Something went wrong.";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="flex w-full max-w-80 flex-col gap-2.5 border border-gray-300 bg-white p-5">
  <h2 class="heading text-xl m-0">New workspace</h2>

  <form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
    <input bind:value={name} class="input" type="text" maxlength="60" placeholder="Workspace name" />
    <button class="button button--accent button--block" disabled={isSubmitting} type="submit">
      {isSubmitting ? "Creating..." : "Create"}
    </button>
  </form>

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
