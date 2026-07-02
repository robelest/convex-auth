<script lang="ts">
  import { fade } from "svelte/transition";

  let { shell = false } = $props<{
    shell?: boolean;
  }>();

  const skeleton =
    "relative overflow-hidden rounded-md bg-background-tertiary/70 animate-pulse motion-reduce:animate-none";
</script>

{#if shell}
  <aside
    class="sticky top-0 flex h-dvh flex-col gap-3 overflow-hidden border-r border-border-transparent bg-background-secondary p-3 max-md:hidden"
    aria-hidden="true"
    transition:fade={{ duration: 120 }}
  >
    <div class="{skeleton} h-3 w-[5.5rem]"></div>
    <div class="{skeleton} h-7 w-full"></div>
    <div class="mt-2 flex flex-col gap-1.5 border-t border-border-transparent pt-3">
      <div class="{skeleton} h-6 w-full"></div>
      <div class="{skeleton} h-6 w-[88%]"></div>
      <div class="{skeleton} h-6 w-[72%]"></div>
    </div>
  </aside>
  <main
    class="grid min-h-dvh place-items-center gap-5 overflow-hidden bg-background-primary p-6"
    aria-busy="true"
    aria-label="Loading"
    transition:fade={{ duration: 140 }}
  >
    <div class="grid min-h-40 w-full max-w-sm place-items-center rounded-lg border border-border-transparent bg-background-secondary shadow-[0_24px_80px_rgb(0_0_0_/_0.24)]">
      <div
        class="size-9 animate-spin rounded-full border-2 border-border-transparent border-t-content-accent motion-reduce:animate-none"
        aria-hidden="true"
      ></div>
      <span class="sr-only">Loading</span>
    </div>
    <div class="grid w-full max-w-2xl grid-cols-3 gap-3 max-md:grid-cols-1" aria-hidden="true">
      <div class="{skeleton} h-[6.5rem]"></div>
      <div class="{skeleton} h-[6.5rem]"></div>
      <div class="{skeleton} h-[6.5rem]"></div>
    </div>
  </main>
{:else}
  <div
    class="grid min-h-dvh place-items-center bg-background-primary p-6"
    aria-busy="true"
    aria-label="Loading"
    transition:fade={{ duration: 140 }}
  >
    <div class="grid size-[6.5rem] place-items-center rounded-lg border border-border-transparent bg-background-secondary shadow-[0_24px_80px_rgb(0_0_0_/_0.24)]">
      <div
        class="size-9 animate-spin rounded-full border-2 border-border-transparent border-t-content-accent motion-reduce:animate-none"
        aria-hidden="true"
      ></div>
      <span class="sr-only">Loading</span>
    </div>
  </div>
{/if}
