<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { useQuery } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import DataTable from '$lib/components/ui/data-table.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import { formatRelative, truncateId } from '$lib/utils/format';

	interface PortalUser {
		_id: string;
		_creationTime: number;
		name?: string;
		email?: string;
		image?: string;
		isAnonymous?: boolean;
		emailVerificationTime?: number;
	}

	const users = useQuery(api.auth.portalQuery, { action: 'listUsers' });

	const typedUsers = $derived((users.data ?? []) as PortalUser[]);

	const columns = [
		{ key: 'id', label: 'ID', width: '120px' },
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'status', label: 'Status', width: '100px' },
		{ key: 'created', label: 'Created', width: '120px' },
	];

	function handleRowClick(user: PortalUser) {
		goto(`${base}/users/${user._id}`);
	}
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<p class="text-[var(--cp-text-xs)] text-cp-text-muted">
				{users.isLoading ? '...' : `${typedUsers.length} users`}
			</p>
		</div>
	</div>

	<!-- Users table -->
	<div class="rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary overflow-hidden">
		<DataTable
			data={typedUsers}
			{columns}
			loading={users.isLoading}
			emptyTitle="No users found"
			emptyDescription="Users will appear here once they sign up."
			onRowClick={handleRowClick}
		>
			{#snippet row(user)}
				<td class="px-4 py-2.5 font-mono text-[var(--cp-text-xs)] text-cp-text-muted">
					{truncateId(user._id)}
				</td>
				<td class="px-4 py-2.5">
					<div class="flex items-center gap-2">
						{#if user.image}
							<img
								src={user.image}
								alt=""
								class="w-5 h-5 rounded-full"
							/>
						{:else}
							<div class="w-5 h-5 rounded-full bg-cp-bg-tertiary flex items-center justify-center text-[var(--cp-text-xs)] text-cp-text-muted">
								{(user.name ?? user.email ?? '?')[0]?.toUpperCase()}
							</div>
						{/if}
						<span class="text-cp-text truncate">
							{user.name ?? '—'}
						</span>
					</div>
				</td>
				<td class="px-4 py-2.5 text-cp-text-secondary truncate">
					{user.email ?? '—'}
				</td>
				<td class="px-4 py-2.5">
					{#if user.isAnonymous}
						<Badge variant="muted">Anonymous</Badge>
					{:else if user.emailVerificationTime}
						<Badge variant="success">Verified</Badge>
					{:else}
						<Badge variant="warning">Unverified</Badge>
					{/if}
				</td>
				<td class="px-4 py-2.5 text-[var(--cp-text-xs)] text-cp-text-muted whitespace-nowrap">
					{formatRelative(user._creationTime)}
				</td>
			{/snippet}
		</DataTable>
	</div>
</div>
