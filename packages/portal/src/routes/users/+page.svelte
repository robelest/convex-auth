<script lang="ts">
	import { goto } from '$app/navigation';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
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
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold">Users</h1>
			<p class="text-sm text-muted-foreground">
				{users.isLoading ? '...' : `${typedUsers.length} users`}
			</p>
		</div>
	</div>

	<!-- Users table -->
	<div class="rounded-lg border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-[120px]">ID</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head>Email</Table.Head>
					<Table.Head class="w-[100px]">Status</Table.Head>
					<Table.Head class="w-[120px]">Created</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if users.isLoading}
					{#each Array(5) as _}
						<Table.Row>
							<Table.Cell><div class="cp-skeleton h-3 w-24 rounded"></div></Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-2">
									<div class="cp-skeleton h-5 w-5 rounded-full"></div>
									<div class="cp-skeleton h-3 w-28 rounded"></div>
								</div>
							</Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-32 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-5 w-16 rounded-full"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
						</Table.Row>
					{/each}
				{:else if typedUsers.length === 0}
					<Table.Row>
						<Table.Cell colspan={5}>
							<div class="flex flex-col items-center justify-center py-12 text-center">
								<p class="text-sm font-medium">No users found</p>
								<p class="text-sm text-muted-foreground">Users will appear here once they sign up.</p>
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each typedUsers as user (user._id)}
						<Table.Row
							class="hover:bg-accent/50 cursor-pointer"
							onclick={() => goto(portalHref(`/users/${user._id}`))}
						>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{truncateId(user._id)}
							</Table.Cell>
							<Table.Cell>
								<div class="flex items-center gap-2">
									{#if user.image}
										<img
											src={user.image}
											alt=""
											class="h-5 w-5 rounded-full object-cover"
										/>
									{:else}
										<div
											class="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
										>
											{(user.name ?? user.email ?? '?')[0]?.toUpperCase()}
										</div>
									{/if}
									<span class="truncate">{user.name ?? '—'}</span>
								</div>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground truncate">
								{user.email ?? '—'}
							</Table.Cell>
							<Table.Cell>
								{#if user.isAnonymous}
									<Badge variant="secondary">Anonymous</Badge>
								{:else if user.emailVerificationTime}
									<Badge variant="default" class="bg-green-600 hover:bg-green-600/90 border-transparent">Verified</Badge>
								{:else}
									<Badge variant="outline" class="text-yellow-600 dark:text-yellow-500">Unverified</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
								{formatRelative(user._creationTime)}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>
