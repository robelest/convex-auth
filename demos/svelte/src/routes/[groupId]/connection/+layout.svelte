<script lang="ts">
  import { useQuery } from "convex-svelte";
  import { getContext } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { api } from "$convex/_generated/api.js";
  import type { AppContext } from "$lib/app";

  let { children } = $props();
  const app = getContext<AppContext>("app");
  const groupId = $derived(page.params.groupId!);

  const dashboard = useQuery(api.groups.get, () => (app.isAuthenticated ? { groupId } : "skip"));
  const canManage = $derived(
    (dashboard.data?.selectedGroup?.permissions as { canManageConnection?: boolean } | undefined)
      ?.canManageConnection ?? null,
  );

  $effect(() => {
    if (!app.isAuthenticated && !app.isLoading) {
      void goto("/");
      return;
    }
    if (canManage === false) {
      void goto(`/${groupId}`);
    }
  });
</script>

{#if app.isAuthenticated && canManage}
  {@render children()}
{:else}
  <div class="col-span-full grid place-items-center py-20">
    <p class="muted">Loading…</p>
  </div>
{/if}
