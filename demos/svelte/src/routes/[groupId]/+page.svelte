<script lang="ts">
	import { getConvexClient, useQuery } from "convex-svelte";
	import { toast } from "svelte-sonner";
	import { page } from "$app/state";
	import { api } from "$convex/_generated/api.js";
	import { getContext } from "svelte";
	import type { AppContext } from "$lib/app";
	import AuthModal from "$lib/components/AuthModal.svelte";
	import OnboardingModal from "$lib/components/OnboardingModal.svelte";
	import AppSidebar from "$lib/components/AppSidebar.svelte";
	import IssueListPanel from "$lib/components/IssueListPanel.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";

	const app = getContext<AppContext>("app");
	const client = getConvexClient();
	type AuthContext = {
		invite?: {
			accept: () => Promise<{ ok: boolean; token?: string }>;
		} | null;
	};
	const auth = getContext<AuthContext>("auth");

	const groupId = $derived(page.params.groupId!);
	let activeTab = $state<"issues" | "settings">("issues");
	let selectedProjectSlug = $state<string | null>(null);

	const dashboard = useQuery(api.groups.get, () => ({ groupId }));

	const workspace = $derived(dashboard.data?.selectedGroup ?? null);
	const user = $derived(dashboard.data?.user ?? null);

	const selectedProject = $derived.by(() => {
		if (!workspace) return null;
		if (selectedProjectSlug) {
			return workspace.projects.find((p: any) => p.slug === selectedProjectSlug) ?? workspace.projects[0] ?? null;
		}
		return workspace.projects[0] ?? null;
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
					if (acceptResult.ok) {
						toast.success("Invite accepted! You've been added to the organization.");
					} else {
						toast.error(typeof acceptResult.message === "string" ? acceptResult.message : "Invalid or expired invite.");
					}
				});
			}
		});
	});
</script>

{#if !app.isAuthenticated}
	<AuthModal authProviders={app.authProviders} />
{:else if dashboard.isLoading && !dashboard.data}
	<main class="p-5 px-6 overflow-y-auto bg-background-primary max-md:p-4">
		<p class="muted">Loading...</p>
	</main>
{:else if !workspace || !user}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 px-4">
		<OnboardingModal {client} />
	</div>
{:else}
	<AppSidebar
		groups={dashboard.data?.groups ?? []}
		selectedGroup={{ groupId: workspace.groupId, name: workspace.name }}
		projects={workspace.projects}
		permissions={{
			canCreateProjects: workspace.permissions.canCreateProjects,
		}}
		bind:activeTab
		bind:selectedProjectSlug
		{client}
		groupId={workspace.groupId}
	/>
	<main class="p-5 px-6 overflow-y-auto bg-background-primary max-md:p-4">
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
							canCreateIssues: workspace.permissions.canCreateIssues,
							canMoveIssues: workspace.permissions.canMoveIssues,
							canEditIssues: workspace.permissions.canEditIssues,
							canAssignIssues: workspace.permissions.canAssignIssues,
							canDeleteIssues: workspace.permissions.canDeleteIssues,
							canCreateComments: workspace.permissions.canCreateComments,
							canDeleteComments: workspace.permissions.canDeleteComments,
						}}
						members={workspace.members.map((m: any) => ({ userId: m.userId, name: m.name }))}
						currentUserId={user.userId}
						groupId={workspace.groupId}
						{client}
					/>
				{/key}
			{:else}
				<p class="muted">No projects yet{workspace.permissions.canCreateProjects ? " — click + New in the sidebar." : "."}</p>
			{/if}
		{:else}
			<SettingsPanel
				user={{ name: user.name, email: user.email }}
				userRoleLabel={workspace.userRoleLabel}
				selectedProject={selectedProject
					? {
						projectId: selectedProject.projectId,
						identifier: selectedProject.identifier,
					}
					: null}
				members={workspace.members}
				permissions={{
					canManageMembers: workspace.permissions.canManageMembers,
					canManageSso: workspace.permissions.canManageConnection,
				}}
				groupId={workspace.groupId}
				{client}
			/>
		{/if}
	</main>
{/if}
