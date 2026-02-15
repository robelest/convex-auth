<script lang="ts">
	import { goto } from '$app/navigation';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { formatRelative, truncateId } from '$lib/utils/format';
	import { Ban, Trash2 } from '@lucide/svelte';

	const keys = useQuery(api.auth.portalQuery, { action: 'listKeys' });
	const client = useConvexClient();

	function isExpired(key: any): boolean {
		return key.expiresAt ? Date.now() > key.expiresAt : false;
	}

	function getKeyStatus(key: any): 'active' | 'revoked' | 'expired' {
		if (key.revoked) return 'revoked';
		if (isExpired(key)) return 'expired';
		return 'active';
	}

	async function handleRevoke(e: Event, keyId: string) {
		e.stopPropagation();
		if (!confirm('Revoke this API key? It will no longer be usable for authentication.')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeKey',
			keyId,
		});
	}

	async function handleDelete(e: Event, keyId: string) {
		e.stopPropagation();
		if (!confirm('Permanently delete this API key? This cannot be undone.')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'deleteKey',
			keyId,
		});
	}
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold">API Keys</h1>
			<p class="text-sm text-muted-foreground">
				{keys.isLoading ? '...' : `${keys.data?.length ?? 0} API keys`}
			</p>
		</div>
	</div>

	<!-- Keys table -->
	<div class="rounded-lg border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-[180px]">Key Prefix</Table.Head>
					<Table.Head class="w-[160px]">Name</Table.Head>
					<Table.Head class="w-[140px]">User</Table.Head>
					<Table.Head class="w-[180px]">Scopes</Table.Head>
					<Table.Head class="w-[100px]">Status</Table.Head>
					<Table.Head class="w-[120px]">Last Used</Table.Head>
					<Table.Head class="w-[120px]">Created</Table.Head>
					<Table.Head class="w-[100px] text-right">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if keys.isLoading}
					{#each Array(5) as _}
						<Table.Row>
							<Table.Cell><div class="cp-skeleton h-3 w-28 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-24 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-24 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-5 w-20 rounded-full"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-5 w-16 rounded-full"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-7 w-16 rounded float-right"></div></Table.Cell>
						</Table.Row>
					{/each}
				{:else if (keys.data?.length ?? 0) === 0}
					<Table.Row>
						<Table.Cell colspan={8}>
							<div class="flex flex-col items-center justify-center py-12 text-center">
								<p class="text-sm font-medium">No API keys</p>
								<p class="text-sm text-muted-foreground">API keys created via auth.key.create() will appear here.</p>
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each keys.data as key (key._id)}
						{@const status = getKeyStatus(key)}
						<Table.Row
							class="hover:bg-accent/50 cursor-pointer"
							onclick={() => goto(portalHref(`/users/${key.userId}`))}
						>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{key.prefix}
							</Table.Cell>
							<Table.Cell class="text-foreground">
								{key.name}
							</Table.Cell>
							<Table.Cell>
								<button
									class="font-mono text-xs text-foreground hover:underline"
									onclick={(e: MouseEvent) => {
										e.stopPropagation();
										goto(portalHref(`/users/${key.userId}`));
									}}
								>
									{truncateId(key.userId)}
								</button>
							</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									{#if key.scopes && key.scopes.length > 0}
										{#each key.scopes as scope}
											{#each scope.actions as action}
												<Badge variant="outline">{scope.resource}:{action}</Badge>
											{/each}
										{/each}
									{:else}
										<span class="text-xs text-muted-foreground">No scopes</span>
									{/if}
								</div>
							</Table.Cell>
							<Table.Cell>
								{#if status === 'active'}
									<Badge variant="default" class="bg-green-600 hover:bg-green-600/90 border-transparent">Active</Badge>
								{:else if status === 'revoked'}
									<Badge variant="destructive">Revoked</Badge>
								{:else}
									<Badge variant="secondary">Expired</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
								{key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Never'}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
								{formatRelative(key.createdAt)}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if status === 'active'}
									<Button
										variant="destructive"
										size="sm"
										onclick={(e: MouseEvent) => handleRevoke(e, key._id)}
									>
										<Ban class="size-3.5" />
										Revoke
									</Button>
								{:else}
									<Button
										variant="ghost"
										size="sm"
										onclick={(e: MouseEvent) => handleDelete(e, key._id)}
									>
										<Trash2 class="size-3.5" />
										Delete
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>
