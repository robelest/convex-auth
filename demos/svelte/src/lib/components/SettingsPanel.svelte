<script lang="ts">
  import type { ConvexClient } from "convex/browser";
  import { api } from "$convex/_generated/api.js";
  import { useQuery } from "convex-svelte";
  import { getContext } from "svelte";

  type AuthContext = {
    signOut: () => Promise<void>;
    passkey?: {
      isSupported: () => boolean;
      register: (opts?: Record<string, unknown>) => Promise<{
        kind: "signedIn" | "redirect";
        redirect?: URL | string;
      }>;
    };
  };

  const auth = getContext<AuthContext>("auth");

  let { user, userRoleLabel, selectedProject, members, permissions, groupId, client } = $props<{
    user: { name: string; email: string | null };
    userRoleLabel: string;
    selectedProject: { projectId: string; identifier: string } | null;
    members: Array<{
      memberId: string;
      userId: string;
      name: string;
      email: string | null;
      roleIds: string[];
    }>;
    permissions: {
      canManageMembers: boolean;
      canManageSso: boolean;
    };
    groupId: string;
    client: ConvexClient;
  }>();

  let tab = $state<"members" | "permissions">("members");
  let isSigningOut = $state(false);
  let errorMessage = $state<string | null>(null);

  // Invite state
  let showInviteForm = $state(false);
  let inviteEmail = $state("");
  let inviteRoleId = $state("member");
  let isInviting = $state(false);
  let inviteSentTo = $state<string | null>(null);
  let isRegisteringPasskey = $state(false);
  let isDeletingPasskeyId = $state<string | null>(null);
  let apiKeyName = $state("");
  let issueReadScope = $state(true);
  let issueWriteScope = $state(false);
  let isCreatingApiKey = $state(false);
  let isRevokingApiKeyId = $state<string | null>(null);
  let createdApiKey = $state<{ keyId: string; secret: string } | null>(null);

  const invitesQuery = useQuery(
    api.groups.listInvites,
    () => permissions.canManageMembers ? { groupId: groupId } : "skip",
  );
  const passkeysQuery = useQuery(api.account.listPasskeys, () => ({}));
  const apiKeysQuery = useQuery(api.account.listApiKeys, () => ({}));
  const pendingInvites = $derived(invitesQuery.data ?? []);
  const passkeys = $derived(passkeysQuery.data ?? []);
  const apiKeys = $derived(apiKeysQuery.data ?? []);
  const passkeySupported = $derived(auth.passkey?.isSupported() ?? false);
  const origin = $derived(typeof window === "undefined" ? "" : window.location.origin);

  const roleOptions = [
    { id: "orgAdmin", label: "Admin" },
    { id: "member", label: "Member" },
    { id: "viewer", label: "Viewer" },
  ];

  function getRoleLabel(roleIds: string[]) {
    if (roleIds.includes("orgAdmin")) return "Admin";
    if (roleIds.includes("member")) return "Member";
    if (roleIds.includes("viewer")) return "Viewer";
    return "Unassigned";
  }

  function formatScopes(
    scopes: Array<{ resource: string; actions: string[] }>,
  ) {
    return scopes
      .map((scope) => `${scope.resource}:${scope.actions.join("/")}`)
      .join(", ");
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
        errorMessage = typeof result.message === "string" ? result.message : "Failed to invite";
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

  async function handleRegisterPasskey() {
    if (!auth.passkey) {
      errorMessage = "Passkeys are not available in this browser.";
      return;
    }
    isRegisteringPasskey = true;
    errorMessage = null;
    try {
      const result = await auth.passkey.register({
        name: typeof navigator === "undefined" ? "This device" : navigator.platform,
      });
      if (result.kind === "redirect" && result.redirect) {
        window.location.href = result.redirect.toString();
      }
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to register passkey";
    } finally {
      isRegisteringPasskey = false;
    }
  }

  async function handleDeletePasskey(passkeyId: string) {
    isDeletingPasskeyId = passkeyId;
    errorMessage = null;
    try {
      await client.mutation(api.account.deletePasskey, { passkeyId });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to delete passkey";
    } finally {
      isDeletingPasskeyId = null;
    }
  }

  async function handleCreateApiKey() {
    if (!apiKeyName.trim()) return;
    isCreatingApiKey = true;
    errorMessage = null;
    createdApiKey = null;
    try {
      createdApiKey = await client.mutation(api.account.createApiKey, {
        name: apiKeyName,
        issueRead: issueReadScope,
        issueWrite: issueWriteScope,
      });
      apiKeyName = "";
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to create API key";
    } finally {
      isCreatingApiKey = false;
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    isRevokingApiKeyId = keyId;
    errorMessage = null;
    try {
      await client.mutation(api.account.revokeApiKey, { keyId });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : "Failed to revoke API key";
    } finally {
      isRevokingApiKeyId = null;
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
    { label: "Manage members & roles", admin: true, member: false, viewer: false },
    { label: "Configure group SSO", admin: true, member: false, viewer: false },
  ];

  const tabs = [
    { id: "members" as const, label: "Members" },
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

  <div class="grid gap-4 md:grid-cols-2">
    <section class="border border-gray-300 bg-white p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="heading text-base m-0">Passkeys</h3>
          <p class="muted m-0">Register a passkey for faster sign-in on this device.</p>
        </div>
        <button
          class="button button--secondary button--compact"
          disabled={!passkeySupported || isRegisteringPasskey}
          onclick={handleRegisterPasskey}
        >{isRegisteringPasskey ? "Adding..." : "Add passkey"}</button>
      </div>

      {#if !passkeySupported}
        <p class="muted">This browser does not support WebAuthn passkeys.</p>
      {:else if passkeys.length === 0}
        <p class="muted">No passkeys registered yet.</p>
      {:else}
        <div class="flex flex-col">
          {#each passkeys as passkey (passkey.passkeyId)}
            <div class="flex justify-between items-center gap-3 py-1.5 border-b border-gray-200">
              <div class="flex flex-col">
                <span class="text-sm text-gray-900">{passkey.name ?? passkey.deviceType}</span>
                <span class="font-label text-[0.6875rem] text-gray-400">
                  {passkey.backedUp ? "Synced" : "Local"}
                  {#if passkey.lastUsedAt}
                    · last used {new Date(passkey.lastUsedAt).toLocaleString()}
                  {/if}
                </span>
              </div>
              <button
                class="button button--ghost text-[0.65rem] text-gray-400 hover:text-accent-600"
                disabled={isDeletingPasskeyId === passkey.passkeyId}
                onclick={() => handleDeletePasskey(passkey.passkeyId)}
              >{isDeletingPasskeyId === passkey.passkeyId ? "removing" : "remove"}</button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="border border-gray-300 bg-white p-4 flex flex-col gap-3">
      <div>
        <h3 class="heading text-base m-0">API keys</h3>
        <p class="muted m-0">Create a key for <code>/api/me</code> and <code>/api/issues</code> curl requests.</p>
      </div>

      <form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleCreateApiKey(); }}>
        <input
          bind:value={apiKeyName}
          class="input input--compact"
          type="text"
          maxlength="60"
          placeholder="CLI key"
        />
        <label class="flex items-center gap-2 font-label text-[0.75rem] text-gray-700">
          <input bind:checked={issueReadScope} type="checkbox" />
          Allow <code>GET /api/issues</code>
        </label>
        <label class="flex items-center gap-2 font-label text-[0.75rem] text-gray-700">
          <input bind:checked={issueWriteScope} type="checkbox" />
          Allow <code>POST /api/issues</code>
        </label>
        <button class="button button--secondary button--compact self-start" disabled={isCreatingApiKey || !apiKeyName.trim()} type="submit">
          {isCreatingApiKey ? "Creating..." : "Create API key"}
        </button>
      </form>

      {#if createdApiKey}
        <div class="flex flex-col gap-2 p-3 border border-gray-200 bg-gray-50">
          <p class="m-0 font-label text-[0.75rem] text-gray-700">Copy this secret now. It will only be shown once.</p>
          <code class="block overflow-x-auto border border-gray-200 bg-white px-2 py-1 text-[0.75rem]">{createdApiKey.secret}</code>
          <code class="block overflow-x-auto border border-gray-200 bg-white px-2 py-1 text-[0.75rem]">curl -H "Authorization: Bearer {createdApiKey.secret}" {origin}/api/me</code>
          {#if selectedProject}
            <code class="block overflow-x-auto border border-gray-200 bg-white px-2 py-1 text-[0.75rem]">curl -H "Authorization: Bearer {createdApiKey.secret}" "{origin}/api/issues?projectId={selectedProject.projectId}"</code>
          {:else}
            <p class="muted m-0">Select a project in the sidebar to get a ready-to-run <code>/api/issues</code> curl command.</p>
          {/if}
        </div>
      {/if}

      {#if apiKeys.length === 0}
        <p class="muted">No API keys yet.</p>
      {:else}
        <div class="flex flex-col">
          {#each apiKeys as key (key.keyId)}
            <div class="flex justify-between items-center gap-3 py-1.5 border-b border-gray-200">
              <div class="flex flex-col">
                <span class="text-sm text-gray-900">{key.name}</span>
                <span class="font-label text-[0.6875rem] text-gray-400">
                  {key.prefix}
                  {#if key.scopes.length > 0}
                    · {formatScopes(key.scopes)}
                  {:else}
                    · no scopes
                  {/if}
                </span>
              </div>
              {#if key.revoked}
                <span class="chip chip--role">Revoked</span>
              {:else}
                <button
                  class="button button--ghost text-[0.65rem] text-gray-400 hover:text-accent-600"
                  disabled={isRevokingApiKeyId === key.keyId}
                  onclick={() => handleRevokeApiKey(key.keyId)}
                >{isRevokingApiKeyId === key.keyId ? "revoking" : "revoke"}</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
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
