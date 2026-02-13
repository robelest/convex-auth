<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import DataTable from '$lib/components/ui/data-table.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { formatRelative, truncateId, isSessionExpired } from '$lib/utils/format';

	const sessions = useQuery(api.auth.portalQuery, { action: 'listSessions' });
	const client = useConvexClient();

	const columns = [
		{ key: 'id', label: 'Session ID', width: '140px' },
		{ key: 'userId', label: 'User ID', width: '140px' },
		{ key: 'status', label: 'Status', width: '100px' },
		{ key: 'created', label: 'Created', width: '120px' },
		{ key: 'expires', label: 'Expires', width: '120px' },
		{ key: 'actions', label: '', width: '80px', align: 'right' as const },
	];

	async function handleRevokeSession(e: Event, sessionId: string) {
		e.stopPropagation();
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeSession',
			sessionId,
		});
	}

	function handleRowClick(session: NonNullable<typeof sessions.data>[number]) {
		goto(`${base}/users/${session.userId}`);
	}
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<p class="text-[var(--cp-text-xs)] text-cp-text-muted">
				{sessions.isLoading ? '...' : `${sessions.data?.length ?? 0} sessions`}
			</p>
		</div>
	</div>

	<!-- Sessions table -->
	<div class="rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary overflow-hidden">
		<DataTable
			data={sessions.data ?? []}
			{columns}
			loading={sessions.isLoading}
			emptyTitle="No sessions found"
			emptyDescription="Active sessions will appear here."
			onRowClick={handleRowClick}
		>
			{#snippet row(session)}
				<td class="px-4 py-2.5 font-mono text-[var(--cp-text-xs)] text-cp-text-muted">
					{truncateId(session._id)}
				</td>
				<td class="px-4 py-2.5 font-mono text-[var(--cp-text-xs)] text-cp-text-secondary">
					<a
						href="{base}/users/{session.userId}"
						class="hover:text-cp-accent transition-colors"
						onclick={(e) => e.stopPropagation()}
					>
						{truncateId(session.userId)}
					</a>
				</td>
				<td class="px-4 py-2.5">
					{#if isSessionExpired(session.expirationTime)}
						<Badge variant="error">Expired</Badge>
					{:else}
						<Badge variant="success">Active</Badge>
					{/if}
				</td>
				<td class="px-4 py-2.5 text-[var(--cp-text-xs)] text-cp-text-muted whitespace-nowrap">
					{formatRelative(session._creationTime)}
				</td>
				<td class="px-4 py-2.5 text-[var(--cp-text-xs)] text-cp-text-muted whitespace-nowrap">
					{formatRelative(session.expirationTime)}
				</td>
				<td class="px-4 py-2.5 text-right">
					{#if !isSessionExpired(session.expirationTime)}
						<Button
							variant="danger"
							size="sm"
							onclick={(e) => handleRevokeSession(e, session._id)}
						>
							Revoke
						</Button>
					{/if}
				</td>
			{/snippet}
		</DataTable>
	</div>
</div>
