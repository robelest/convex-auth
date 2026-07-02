<script lang="ts">
  import type { Snippet } from "svelte";

  import { useConvexAuth } from "./context.svelte.js";

  let { children }: { children: Snippet } = $props();

  const auth = useConvexAuth();
</script>

{#if auth.signedOut}
  {@render children()}
{/if}
