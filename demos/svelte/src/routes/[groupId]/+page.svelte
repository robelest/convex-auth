<script lang="ts">
	import { useQuery, useConvexClient } from "convex-svelte";
	import { api } from "$convex/_generated/api.js";
	import { getContext } from "svelte";
	import AuthModal from "$lib/components/AuthModal.svelte";
	import OnboardingModal from "$lib/components/OnboardingModal.svelte";
	import AppSidebar from "$lib/components/AppSidebar.svelte";
	import IssueListPanel from "$lib/components/IssueListPanel.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";

	let { data } = $props();
	const client = useConvexClient();
	type AuthContext = {
		invite?: {
			accept: () => Promise<{ ok: boolean; token?: string }>;
		} | null;
	};
	const auth = getContext<AuthContext>("auth");

	let activeTab = $state<"issues" | "settings">("issues");
	let selectedProjectSlug = $state<string | null>(null);
	let inviteMessage = $state<string | null>(null);

	const dashboard = useQuery(api.groups.get, () => ({
		groupId: data.groupId,
	}), () => ({
		initialData: data.demo ?? undefined,
	}));

	const ws = $derived(dashboard.data?.selectedGroup ?? null);
	const user = $derived(dashboard.data?.user ?? null);

	const selectedProject = $derived.by(() => {
		if (!ws) return null;
		if (selectedProjectSlug) {
			return ws.projects.find((p: any) => p.slug === selectedProjectSlug) ?? ws.projects[0] ?? null;
		}
		return ws.projects[0] ?? null;
	});

	$effect(() => {
		if (selectedProject && !selectedProjectSlug) {
			selectedProjectSlug = selectedProject.slug;
		}
	});

	let inviteHandled = $state(false);
	$effect(() => {
		if (inviteHandled || !user || !auth.invite) return;
		inviteHandled = true;
			auth.invite.accept().then((result: { ok: boolean; token?: string }) => {
				if (result.ok && result.token) {
						client.mutation(api.groups.acceptInvite, { token: result.token }).then((acceptResult: any) => {
					inviteMessage = acceptResult.ok
						? "Invite accepted! You've been added to the organization."
						: acceptResult.message ?? "Invalid or expired invite.";
					setTimeout(() => { inviteMessage = null; }, 5000);
				});
			}
		});
	});
</script>

{#if !data.auth.isAuthenticated}
	<AuthModal authProviders={data.authProviders} />
{:else if dashboard.isLoading && !dashboard.data}
	<main class="p-5 px-6 overflow-y-auto max-md:p-4">
		<p class="muted">Loading...</p>
	</main>
{:else if !ws || !user}
	<div class="col-span-full grid min-h-dvh place-items-center p-6 px-4">
		<OnboardingModal {client} />
	</div>
{:else}
	<AppSidebar
		groups={dashboard.data?.groups ?? []}
		selectedGroup={{ groupId: ws.groupId, name: ws.name }}
		projects={ws.projects}
		permissions={{
			canCreateProjects: ws.permissions.canCreateProjects,
		}}
		bind:activeTab
		bind:selectedProjectSlug
		{client}
		groupId={ws.groupId}
	/>
	<main class="p-5 px-6 overflow-y-auto max-md:p-4">
		{#if inviteMessage}
			<div class="mb-3 px-3 py-2 border border-gray-300 bg-gray-100 font-label text-[0.75rem] text-gray-700">{inviteMessage}</div>
		{/if}
		{#if activeTab === "issues"}
			{#if selectedProject}
				{#key selectedProject.projectId}
					<IssueListPanel
						project={{
							projectId: selectedProject.projectId,
							name: selectedProject.name,
							identifier: selectedProject.identifier,
							slug: selectedProject.slug,
							description: selectedProject.description,
						}}
						permissions={{
							canCreateIssues: ws.permissions.canCreateIssues,
							canMoveIssues: ws.permissions.canMoveIssues,
							canEditIssues: ws.permissions.canEditIssues,
							canAssignIssues: ws.permissions.canAssignIssues,
							canDeleteIssues: ws.permissions.canDeleteIssues,
							canCreateComments: ws.permissions.canCreateComments,
							canDeleteComments: ws.permissions.canDeleteComments,
						}}
						members={ws.members.map((m: any) => ({ userId: m.userId, name: m.name }))}
						currentUserId={user.userId}
						groupId={ws.groupId}
						{client}
					/>
				{/key}
			{:else}
				<p class="muted">No projects yet{ws.permissions.canCreateProjects ? " — click + New in the sidebar." : "."}</p>
			{/if}
		{:else}
			<SettingsPanel
				user={{ name: user.name, email: user.email }}
				userRoleLabel={ws.userRoleLabel}
				selectedProject={selectedProject
					? {
						projectId: selectedProject.projectId,
						identifier: selectedProject.identifier,
					}
					: null}
				members={ws.members}
				permissions={{
					canManageMembers: ws.permissions.canManageMembers,
					canManageSso: ws.permissions.canManageSso,
				}}
				groupId={ws.groupId}
				{client}
			/>
		{/if}
	</main>
{/if}
