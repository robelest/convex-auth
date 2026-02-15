<script lang="ts">
	import { goto } from '$app/navigation';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { formatRelative, truncateId, isSessionExpired } from '$lib/utils/format';
	import { Ban } from '@lucide/svelte';

	const sessions = useQuery(api.auth.portalQuery, { action: 'listSessions' });
	const client = useConvexClient();

	async function handleRevoke(e: Event | MouseEvent, sessionId: string) {
		e.stopPropagation();
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeSession',
			sessionId,
		});
	}
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold">Sessions</h1>
			<p class="text-sm text-muted-foreground">
				{sessions.isLoading ? '...' : `${sessions.data?.length ?? 0} sessions`}
			</p>
		</div>
	</div>

	<!-- Sessions table -->
	<div class="rounded-lg border bg-card">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-[140px]">Session ID</Table.Head>
					<Table.Head class="w-[140px]">User ID</Table.Head>
					<Table.Head class="w-[100px]">Status</Table.Head>
					<Table.Head class="w-[120px]">Created</Table.Head>
					<Table.Head class="w-[120px]">Expires</Table.Head>
					<Table.Head class="w-[80px] text-right">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if sessions.isLoading}
					{#each Array(5) as _}
						<Table.Row>
							<Table.Cell><div class="cp-skeleton h-3 w-24 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-24 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-5 w-16 rounded-full"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-7 w-16 rounded float-right"></div></Table.Cell>
						</Table.Row>
					{/each}
				{:else if (sessions.data?.length ?? 0) === 0}
					<Table.Row>
						<Table.Cell colspan={6}>
							<div class="flex flex-col items-center justify-center py-12 text-center">
								<p class="text-sm font-medium">No sessions found</p>
								<p class="text-sm text-muted-foreground">Active sessions will appear here.</p>
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each sessions.data as session (session._id)}
						<Table.Row
							class="hover:bg-accent/50 cursor-pointer"
							onclick={() => goto(portalHref(`/users/${session.userId}`))}
						>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{truncateId(session._id)}
							</Table.Cell>
							<Table.Cell>
								<button
									class="font-mono text-xs text-foreground hover:underline"
									onclick={(e: MouseEvent) => {
										e.stopPropagation();
										goto(portalHref(`/users/${session.userId}`));
									}}
								>
									{truncateId(session.userId)}
								</button>
							</Table.Cell>
							<Table.Cell>
								{#if isSessionExpired(session.expirationTime)}
									<Badge variant="secondary">Expired</Badge>
								{:else}
									<Badge variant="default" class="bg-green-600 hover:bg-green-600/90 border-transparent">Active</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
								{formatRelative(session._creationTime)}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
								{formatRelative(session.expirationTime)}
							</Table.Cell>
							<Table.Cell class="text-right">
								{#if !isSessionExpired(session.expirationTime)}
									<Button
										variant="destructive"
										size="sm"
										onclick={(e: MouseEvent) => handleRevoke(e, session._id)}
									>
										<Ban class="size-3.5" />
										Revoke
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
