<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { useQuery } from "convex-svelte";
  import { getContext } from "svelte";

  type AuthContext = {
    signOut: () => Promise<void>;
  };

  const auth = getContext<AuthContext>("auth");

  let { user, userRoleLabel, members, teams, permissions, groupId, client } = $props<{
    user: { name: string; email: string | null };
    userRoleLabel: string;
    members: Array<{
      memberId: string;
      userId: string;
      name: string;
      email: string | null;
      roleIds: string[];
    }>;
    teams: Array<{
      groupId: string;
      name: string;
      children: Array<{ name: string }>;
    }>;
    permissions: {
      canManageTeams: boolean;
      canManageMembers: boolean;
      canManageSso: boolean;
    };
    groupId: string;
    client: ConvexClient;
  }>();

  let tab = $state<"members" | "teams" | "permissions">("members");
  let newTeamName = $state("");
  let isSubmitting = $state(false);
  let isSigningOut = $state(false);
  let errorMessage = $state<string | null>(null);

  // Invite state
  let showInviteForm = $state(false);
  let inviteEmail = $state("");
  let inviteRoleId = $state("member");
  let isInviting = $state(false);
  let inviteSentTo = $state<string | null>(null);

  const invitesQuery = useQuery(
    api.groups.listInvites,
    () => permissions.canManageMembers ? { groupId: groupId } : "skip" as any,
  );
  const pendingInvites = $derived(invitesQuery.data ?? []);

  const roleOptions = [
    { id: "orgAdmin", label: "Admin" },
    { id: "member", label: "Member" },
    { id: "viewer", label: "Viewer" },
  ];

  function getRoleLabel(roleIds: string[]) {
    if (roleIds.includes("orgAdmin")) return "Admin";
    if (roleIds.includes("member")) return "Member";
    return "Viewer";
  }

  async function handleCreateTeam() {
    if (newTeamName.trim().length === 0) return;
    isSubmitting = true;
    errorMessage = null;
    try {
      await client.mutation(api.groups.createTeam, {
        groupId: groupId,
        name: newTeamName,
      });
      newTeamName = "";
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to create team";
    } finally {
      isSubmitting = false;
    }
  }

  async function handleRoleChange(memberId: string, newRoleId: string) {
    errorMessage = null;
    try {
      await client.mutation(api.groups.updateMemberRole, {
        groupId: groupId,
        memberId,
        roleId: newRoleId,
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to update role";
    }
  }

  async function handleSignOut() {
    isSigningOut = true;
    try {
      await auth.signOut();
      window.location.reload();
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Sign out failed";
    } finally {
      isSigningOut = false;
    }
  }

  async function handleInvite() {
    if (!inviteEmail.includes("@")) return;
    isInviting = true;
    errorMessage = null;
    inviteSentTo = null;
    const emailToSend = inviteEmail;
    try {
      const result = await client.action(api.groups.inviteMember, {
        groupId: groupId,
        email: inviteEmail,
        roleId: inviteRoleId,
      });
      if ("ok" in result && result.ok) {
        inviteSentTo = emailToSend;
        inviteEmail = "";
        setTimeout(() => { inviteSentTo = null; }, 4000);
      } else if ("message" in result) {
        errorMessage = (result as any).message;
      }
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to invite";
    } finally {
      isInviting = false;
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    errorMessage = null;
    try {
      await client.mutation(api.groups.revokeInvite, {
        groupId: groupId,
        inviteId,
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to revoke";
    }
  }

  const permissionMatrix = [
    { label: "View projects & issues", admin: true, member: true, viewer: true },
    { label: "Create issues", admin: true, member: true, viewer: false },
    { label: "Edit issues", admin: true, member: true, viewer: false },
    { label: "Move issue status", admin: true, member: true, viewer: false },
    { label: "Assign issues to others", admin: true, member: false, viewer: false },
    { label: "Delete issues", admin: true, member: false, viewer: false },
    { label: "Create projects", admin: true, member: false, viewer: false },
    { label: "Manage teams", admin: true, member: false, viewer: false },
    { label: "Manage members & roles", admin: true, member: false, viewer: false },
    { label: "Configure group SSO", admin: true, member: false, viewer: false },
  ];

  const tabs = [
    { id: "members" as const, label: "Members" },
    { id: "teams" as const, label: "Teams" },
    { id: "permissions" as const, label: "Permissions" },
  ];
</script>

<div class="flex flex-col gap-4">
  <!-- Account bar -->
  <div class="flex justify-between items-center gap-3 pb-3 border-b border-gray-300">
    <div class="flex items-center gap-2">
      <span class="font-label text-[0.75rem] text-gray-700">{user.name}</span>
      <span class="chip chip--role">{userRoleLabel}</span>
    </div>
    <button
      class="button button--secondary button--compact"
      disabled={isSigningOut}
      onclick={handleSignOut}
    >{isSigningOut ? "..." : "Sign out"}</button>
  </div>

  <!-- Tabs -->
  <div class="flex gap-0 border-b border-gray-300">
    {#each tabs as t (t.id)}
      <button
        class="py-2 px-4 border-0 border-b-2 bg-transparent font-label text-[0.75rem] font-medium cursor-pointer {tab === t.id ? 'border-b-accent-500 text-accent-600 font-semibold' : 'border-b-transparent text-gray-500 hover:text-gray-700'}"
        onclick={() => { tab = t.id; }}
      >{t.label}</button>
    {/each}
  </div>

  <!-- Tab content -->
  {#if tab === "members"}
    <!-- Action buttons -->
    {#if permissions.canManageMembers || permissions.canManageSso}
      <div class="flex gap-2">
        {#if permissions.canManageMembers}
          <button
            class="button button--secondary button--compact"
            onclick={() => { showInviteForm = !showInviteForm; inviteSentTo = null; }}
          >{showInviteForm ? "Cancel" : "Invite member"}</button>
        {/if}
        {#if permissions.canManageSso}
          <a class="button button--secondary button--compact no-underline" href="/{groupId}/sso">
            Configure SSO
          </a>
        {/if}
      </div>
    {/if}

    <!-- Invite form -->
    {#if showInviteForm}
      <div class="flex flex-col gap-2 p-3 border border-gray-200 bg-gray-50">
        <form class="flex gap-1.5 items-center flex-wrap" onsubmit={(e) => { e.preventDefault(); handleInvite(); }}>
          <input
            class="input input--compact flex-1 min-w-[10rem]"
            bind:value={inviteEmail}
            type="email"
            placeholder="Email address"
          />
          <select class="select select--compact" bind:value={inviteRoleId}>
            {#each roleOptions as role (role.id)}
              <option value={role.id}>{role.label}</option>
            {/each}
          </select>
          <button
            class="button button--accent button--compact"
            type="submit"
            disabled={isInviting || !inviteEmail.includes("@")}
          >{isInviting ? "..." : "Send"}</button>
        </form>

        {#if inviteSentTo}
          <p class="font-label text-[0.75rem] text-green-600 m-0">Invite sent to {inviteSentTo}</p>
        {/if}

        <!-- Pending invites -->
        {#if pendingInvites.length > 0}
          <div class="flex flex-col mt-1">
            <span class="font-label text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-gray-400 mb-1">Pending</span>
            {#each pendingInvites as invite (invite.inviteId)}
              <div class="flex justify-between items-center gap-2 py-1 border-b border-gray-200">
                <div class="flex items-center gap-2">
                  <span class="font-label text-[0.75rem] text-gray-700">{invite.email ?? "—"}</span>
                  <span class="chip chip--role">{getRoleLabel(invite.roleIds)}</span>
                </div>
                <button
                  class="button button--ghost text-[0.65rem] text-gray-400 hover:text-accent-600"
                  onclick={() => handleRevokeInvite(invite.inviteId)}
                >revoke</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Member list -->
    <div class="flex flex-col">
      {#each members as member (member.userId)}
        <div class="flex justify-between items-center gap-2 py-1.5 border-b border-gray-200">
          <div class="flex flex-col">
            <span class="text-sm text-gray-900">{member.name}</span>
            {#if member.email}
              <span class="font-label text-[0.6875rem] text-gray-400">{member.email}</span>
            {/if}
          </div>
          {#if permissions.canManageMembers}
            <select
              class="select select--compact"
              value={member.roleIds[0] ?? "viewer"}
              onchange={(e) => handleRoleChange(member.memberId, e.currentTarget.value)}
            >
              {#each roleOptions as role (role.id)}
                <option value={role.id}>{role.label}</option>
              {/each}
            </select>
          {:else}
            <span class="chip chip--role">{getRoleLabel(member.roleIds)}</span>
          {/if}
        </div>
      {:else}
        <p class="muted">No members.</p>
      {/each}
    </div>

  {:else if tab === "teams"}
    <div class="flex flex-col">
      {#each teams as team (team.groupId)}
        <div class="flex justify-between items-center gap-2 py-1.5 border-b border-gray-200">
          <span class="text-sm text-gray-900">{team.name}</span>
          {#if team.children.length > 0}
            <span class="font-label text-xs text-gray-500">{team.children.map((c: { name: string }) => c.name).join(", ")}</span>
          {/if}
        </div>
      {:else}
        <p class="muted">No teams.</p>
      {/each}
    </div>
    {#if permissions.canManageTeams}
      <div class="flex gap-1.5 items-center mt-2">
        <input bind:value={newTeamName} class="input input--compact flex-1" maxlength="50" placeholder="New team" type="text" />
        <button class="button button--secondary button--compact" disabled={isSubmitting} onclick={handleCreateTeam}>
          {isSubmitting ? "Adding..." : "Add"}
        </button>
      </div>
    {/if}

  {:else if tab === "permissions"}
    <div class="overflow-x-auto">
      <table class="w-full font-label text-[0.75rem]">
        <thead>
          <tr class="border-b border-gray-300">
            <th class="text-left py-1.5 pr-4 text-gray-500 font-semibold">Action</th>
            <th class="text-center py-1.5 px-3 text-gray-500 font-semibold">Admin</th>
            <th class="text-center py-1.5 px-3 text-gray-500 font-semibold">Member</th>
            <th class="text-center py-1.5 px-3 text-gray-500 font-semibold">Viewer</th>
          </tr>
        </thead>
        <tbody>
          {#each permissionMatrix as row (row.label)}
            <tr class="border-b border-gray-200">
              <td class="py-1.5 pr-4 text-gray-700">{row.label}</td>
              <td class="text-center py-1.5 px-3 {row.admin ? 'text-green-600' : 'text-gray-300'}">{row.admin ? "yes" : "—"}</td>
              <td class="text-center py-1.5 px-3 {row.member ? 'text-green-600' : 'text-gray-300'}">{row.member ? "yes" : "—"}</td>
              <td class="text-center py-1.5 px-3 {row.viewer ? 'text-green-600' : 'text-gray-300'}">{row.viewer ? "yes" : "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if errorMessage}
    <p class="error-banner">{errorMessage}</p>
  {/if}
</div>
