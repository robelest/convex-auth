<script lang="ts">
  import { useConvexClient } from "convex-svelte";

  import AuthModal from "$lib/components/AuthModal.svelte";
  import OnboardingModal from "$lib/components/OnboardingModal.svelte";

  let { data } = $props();
  const client = useConvexClient();
</script>

{#if !data.auth.isAuthenticated}
  <AuthModal authProviders={data.authProviders} />
{:else}
  <OnboardingModal {client} />
{/if}
