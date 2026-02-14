<script lang="ts">
	import { goto } from '$app/navigation';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import DataTable from '$lib/components/ui/data-table.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { formatRelative, truncateId } from '$lib/utils/format';

	const keys = useQuery(api.auth.portalQuery, { action: 'listKeys' });
	const client = useConvexClient();

	const columns = [
		{ key: 'prefix', label: 'Key', width: '180px' },
		{ key: 'name', label: 'Name', width: '160px' },
		{ key: 'userId', label: 'User', width: '140px' },
		{ key: 'scopes', label: 'Scopes', width: '180px' },
		{ key: 'status', label: 'Status', width: '100px' },
		{ key: 'lastUsed', label: 'Last Used', width: '120px' },
		{ key: 'created', label: 'Created', width: '120px' },
		{ key: 'actions', label: '', width: '80px', align: 'right' as const },
	];

	function isExpired(key: any): boolean {
		return key.expiresAt ? Date.now() > key.expiresAt : false;
	}

	function getKeyStatus(key: any): 'active' | 'revoked' | 'expired' {
		if (key.revoked) return 'revoked';
		if (isExpired(key)) return 'expired';
		return 'active';
	}

	function formatScopes(scopes: Array<{ resource: string; actions: string[] }>): string {
		if (!scopes || scopes.length === 0) return 'No scopes';
		return scopes.map((s) => `${s.resource}:${s.actions.join(',')}`).join('; ');
	}

	async function handleRevokeKey(e: Event, keyId: string) {
		e.stopPropagation();
		if (!confirm('Revoke this API key? It will no longer be usable for authentication.')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeKey',
			keyId,
		});
	}

	async function handleDeleteKey(e: Event, keyId: string) {
		e.stopPropagation();
		if (!confirm('Permanently delete this API key? This cannot be undone.')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'deleteKey',
			keyId,
		});
	}

	function handleRowClick(key: any) {
		goto(portalHref(`/users/${key.userId}`));
	}
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<p class="text-[var(--cp-text-xs)] text-cp-text-muted">
				{keys.isLoading ? '...' : `${keys.data?.length ?? 0} API keys`}
			</p>
		</div>
	</div>

	<!-- Keys table -->
	<div
		class="rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary overflow-hidden"
	>
		<DataTable
			data={keys.data ?? []}
			{columns}
			loading={keys.isLoading}
			emptyTitle="No API keys"
			emptyDescription="API keys created via auth.key.create() will appear here."
			onRowClick={handleRowClick}
		>
			{#snippet row(key)}
				<td class="px-4 py-2.5 font-mono text-[var(--cp-text-xs)] text-cp-text-muted">
					{key.prefix}
				</td>
				<td class="px-4 py-2.5 text-[var(--cp-text-sm)] text-cp-text">
					{key.name}
				</td>
				<td class="px-4 py-2.5 font-mono text-[var(--cp-text-xs)] text-cp-text-secondary">
					<a
						href={portalHref(`/users/${key.userId}`)}
						class="hover:text-cp-accent transition-colors"
						onclick={(e) => e.stopPropagation()}
					>
						{truncateId(key.userId)}
					</a>
				</td>
				<td
					class="px-4 py-2.5 text-[var(--cp-text-xs)] text-cp-text-muted max-w-[180px] truncate"
					title={formatScopes(key.scopes)}
				>
					{formatScopes(key.scopes)}
				</td>
				<td class="px-4 py-2.5">
					{#if getKeyStatus(key) === 'active'}
						<Badge variant="success">Active</Badge>
					{:else if getKeyStatus(key) === 'revoked'}
						<Badge variant="error">Revoked</Badge>
					{:else}
						<Badge variant="warning">Expired</Badge>
					{/if}
				</td>
				<td class="px-4 py-2.5 text-[var(--cp-text-xs)] text-cp-text-muted whitespace-nowrap">
					{key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Never'}
				</td>
				<td class="px-4 py-2.5 text-[var(--cp-text-xs)] text-cp-text-muted whitespace-nowrap">
					{formatRelative(key.createdAt)}
				</td>
				<td class="px-4 py-2.5 text-right">
					{#if getKeyStatus(key) === 'active'}
						<Button
							variant="danger"
							size="sm"
							onclick={(e) => handleRevokeKey(e, key._id)}
						>
							Revoke
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							onclick={(e) => handleDeleteKey(e, key._id)}
						>
							Delete
						</Button>
					{/if}
				</td>
			{/snippet}
		</DataTable>
	</div>
</div>
