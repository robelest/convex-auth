<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { fly, fade } from "svelte/transition";
  import List from "phosphor-svelte/lib/List";
  import X from "phosphor-svelte/lib/X";

  let {
    groups,
    selectedGroup,
    projects,
    permissions,
    activeTab = $bindable("issues"),
    selectedProjectSlug = $bindable(null),
    client,
    groupId,
  } = $props<{
    groups: Array<{ groupId: string; name: string }>;
    selectedGroup: { groupId: string; name: string };
    projects: Array<{
      projectId: string;
      name: string;
      identifier: string;
      slug: string;
      openIssueCount: number;
    }>;
    permissions: {
      canCreateProjects: boolean;
    };
    activeTab: "issues" | "settings";
    selectedProjectSlug: string | null;
    client: ConvexClient;
    groupId: string;
  }>();

  let mobileOpen = $state(false);

  // New project form
  let showNewProject = $state(false);
  let newProjectName = $state("");
  let newProjectIdentifier = $state("");
  let newProjectError = $state<string | null>(null);
  let isCreatingProject = $state(false);

  function switchGroup(id: string) {
    window.location.pathname = `/${id}`;
  }

  function selectProject(slug: string) {
    selectedProjectSlug = slug;
    activeTab = "issues";
    mobileOpen = false;
  }

  function openNewProject() {
    showNewProject = true;
    newProjectName = "";
    newProjectIdentifier = "";
    newProjectError = null;
  }

  async function handleCreateProject() {
    if (!newProjectName.trim() || !newProjectIdentifier.trim()) return;
    isCreatingProject = true;
    newProjectError = null;
    try {
      const result = await client.mutation(api.projects.createProject, {
        groupId: groupId,
        name: newProjectName.trim(),
        identifier: newProjectIdentifier.trim(),
        description: "",
      });
      if ("ok" in result && !result.ok && "message" in result) {
        newProjectError = typeof result.message === "string" ? result.message : "Failed to create project";
      } else {
        showNewProject = false;
      }
    } catch (e: unknown) {
      newProjectError = e instanceof Error ? e.message : "Failed to create project";
    } finally {
      isCreatingProject = false;
    }
  }

  function goToSettings() {
    activeTab = "settings";
    mobileOpen = false;
  }
</script>

<!-- Mobile: hamburger bar -->
<header class="hidden max-md:flex items-center gap-3 px-4 py-2.5 border-b border-gray-300 bg-gray-50 shrink-0">
  <button
    class="bg-transparent border-0 p-0 cursor-pointer flex items-center text-gray-600"
    onclick={() => { mobileOpen = true; }}
    aria-label="Open menu"
  >
    <List size={20} />
  </button>
  <span class="font-label text-[0.75rem] font-semibold text-gray-700 truncate">{selectedGroup.name}</span>
</header>

<!-- Mobile: slide-out sheet -->
{#if mobileOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/30 z-40 md:hidden"
    transition:fade={{ duration: 100 }}
    onclick={() => { mobileOpen = false; }}
  ></div>

  <aside
    class="fixed inset-y-0 left-0 w-64 z-50 py-4 bg-gray-50 flex flex-col overflow-y-auto shadow-lg md:hidden"
    transition:fly={{ x: -300, duration: 200 }}
  >
    <div class="px-3 flex items-center justify-between h-6">
      <span class="font-label text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-gray-500 leading-none">convex-auth</span>
      <button
        class="bg-transparent border-0 p-0 cursor-pointer flex items-center text-gray-400 hover:text-gray-600 leading-none"
        onclick={() => { mobileOpen = false; }}
        aria-label="Close menu"
      >
        <X size={16} />
      </button>
    </div>

    {@render sidebarContent()}
  </aside>
{/if}

<!-- Desktop: static sidebar -->
<aside class="sticky top-0 h-dvh py-4 border-r border-gray-300 bg-gray-50 flex flex-col overflow-y-auto max-md:hidden">
  <div class="px-3 flex flex-col gap-1.5">
    <p class="label">convex-auth</p>
  </div>

  {@render sidebarContent()}
</aside>

{#snippet sidebarContent()}
  <div class="px-3 mt-1">
    <select
      class="select select--compact w-full"
      value={selectedGroup.groupId}
      onchange={(e) => switchGroup(e.currentTarget.value)}
    >
      {#each groups as ws (ws.groupId)}
        <option value={ws.groupId}>{ws.name}</option>
      {/each}
    </select>
  </div>

  <nav class="mt-3 pt-3 border-t border-gray-300 flex flex-col gap-0.5 flex-1 overflow-y-auto">
    <div class="flex items-center justify-between px-3 mb-1">
      <p class="font-label text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-gray-400 m-0">Projects</p>
      {#if permissions.canCreateProjects}
        <button
          class="font-label text-[0.65rem] font-semibold text-accent-500 hover:text-accent-600 bg-transparent border-0 cursor-pointer p-0"
          onclick={openNewProject}
        >+ New</button>
      {/if}
    </div>

    {#if showNewProject}
      <form class="px-3 pb-2 flex flex-col gap-1.5 border-b border-gray-200 mb-1" onsubmit={(e) => { e.preventDefault(); handleCreateProject(); }}>
        <input class="input input--compact w-full" bind:value={newProjectName} placeholder="Project name" maxlength="50" type="text" />
        <input class="input input--compact w-full" bind:value={newProjectIdentifier} placeholder="ID (e.g. AUTH)" maxlength="6" type="text" style="text-transform: uppercase" />
        <div class="flex gap-1">
          <button class="button button--accent button--compact flex-1" type="submit" disabled={isCreatingProject || !newProjectName.trim() || !newProjectIdentifier.trim()}>
            {isCreatingProject ? "..." : "Create"}
          </button>
          <button class="button button--secondary button--compact" type="button" onclick={() => { showNewProject = false; }}>Cancel</button>
        </div>
        {#if newProjectError}
          <p class="error-banner">{newProjectError}</p>
        {/if}
      </form>
    {/if}

    {#each projects as project (project.projectId)}
      <button
        class="block w-full py-[0.3rem] px-3 border-0 border-l-2 border-l-transparent bg-transparent font-label text-[0.75rem] font-medium text-left text-gray-700 cursor-pointer hover:text-accent-600 hover:bg-gray-100 {selectedProjectSlug === project.slug && activeTab === 'issues' ? 'border-l-accent-500 !text-accent-600 font-semibold bg-gray-100' : ''}"
        onclick={() => selectProject(project.slug)}
      >
        <span class="font-semibold text-gray-400">{project.identifier}</span>
        <span class="ml-1">{project.name}</span>
        {#if project.openIssueCount > 0}
          <span class="ml-1 text-[0.625rem] text-gray-400">{project.openIssueCount}</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="mt-auto pt-3 px-3 border-t border-gray-300">
    <button
      class="block w-full py-[0.3rem] px-3 border-0 border-l-2 border-l-transparent bg-transparent font-label text-[0.75rem] font-medium text-left text-gray-700 cursor-pointer hover:text-accent-600 {activeTab === 'settings' ? 'border-l-accent-500 !text-accent-600 font-semibold' : ''}"
      onclick={goToSettings}
    >Settings</button>
  </div>
{/snippet}
