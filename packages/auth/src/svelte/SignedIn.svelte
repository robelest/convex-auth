<script lang="ts">
  import type { Snippet } from "svelte";

  import { useConvexAuth } from "./context.svelte.js";

  let { children }: { children: Snippet<[string]> } = $props();

  const auth = useConvexAuth();
  const state = $derived(auth.state);
</script>

{#if state.status === "signedIn"}
  {@render children(state.token)}
{/if}
