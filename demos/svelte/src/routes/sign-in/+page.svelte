<script lang="ts">
  import { page } from "$app/state";
  import { getContext } from "svelte";
  import type { AppContext } from "$lib/app";
  import AuthModal from "$lib/components/AuthModal.svelte";

  const app = getContext<AppContext>("app");

  const redirectTo = page.url.searchParams.get("redirect_to");

  function safeContinue(target: string | null): string | null {
    if (!target) return null;
    try {
      const url = new URL(target, page.url.origin);
      const sameOrigin = url.origin === page.url.origin;
      const convexSite = /\.convex\.(site|cloud)$/.test(url.hostname);
      return sameOrigin || convexSite ? url.toString() : null;
    } catch {
      return null;
    }
  }

  $effect(() => {
    if (!app.isAuthenticated) return;
    const target = safeContinue(redirectTo);
    if (target) window.location.href = target;
  });
</script>

<div class="col-span-full flex min-h-dvh w-full items-center justify-center p-4">
  {#if app.isAuthenticated}
    <p class="muted">Signing you in…</p>
  {:else}
    <div class="flex w-full max-w-80 flex-col gap-3">
      <p class="muted text-center">Sign in to continue.</p>
      <AuthModal authProviders={app.authProviders} />
    </div>
  {/if}
</div>
