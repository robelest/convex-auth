<script lang="ts">
	import { goto } from '$app/navigation';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import * as Table from '$lib/components/ui/table';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { formatRelative, truncateId } from '$lib/utils/format';
	import { Plus, UsersRound } from '@lucide/svelte';

	interface PortalGroup {
		_id: string;
		_creationTime: number;
		name: string;
		slug?: string;
		type?: string;
		parentGroupId?: string;
		extend?: Record<string, unknown>;
	}

	const groups = useQuery(api.auth.portalQuery, { action: 'listGroups' });
	const client = useConvexClient();

	const typedGroups = $derived((groups.data ?? []) as PortalGroup[]);

	// Create Group dialog state
	let dialogOpen = $state(false);
	let groupName = $state('');
	let groupType = $state('');
	let groupSlug = $state('');
	let creating = $state(false);

	async function handleCreateGroup() {
		if (!groupName.trim()) return;
		creating = true;
		try {
			await client.mutation(api.auth.portalMutation, {
				action: 'createGroup',
				groupName: groupName.trim(),
				...(groupType.trim() ? { groupType: groupType.trim() } : {}),
				...(groupSlug.trim() ? { groupSlug: groupSlug.trim() } : {}),
			});
			dialogOpen = false;
			groupName = '';
			groupType = '';
			groupSlug = '';
		} finally {
			creating = false;
		}
	}
</script>

<div class="space-y-4">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-lg font-semibold">Groups</h1>
			<p class="text-sm text-muted-foreground">
				{groups.isLoading ? '...' : `${typedGroups.length} groups`}
			</p>
		</div>
		<Dialog.Root bind:open={dialogOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} size="sm">
						<Plus class="size-4" />
						Create Group
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>Create Group</Dialog.Title>
					<Dialog.Description>Add a new group to your application.</Dialog.Description>
				</Dialog.Header>
				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault();
						handleCreateGroup();
					}}
				>
					<div class="space-y-2">
						<label for="group-name" class="text-sm font-medium leading-none">
							Name <span class="text-destructive">*</span>
						</label>
						<Input
							id="group-name"
							placeholder="e.g. Engineering"
							bind:value={groupName}
							required
						/>
					</div>
					<div class="space-y-2">
						<label for="group-type" class="text-sm font-medium leading-none">Type</label>
						<Input
							id="group-type"
							placeholder="e.g. team, org (optional)"
							bind:value={groupType}
						/>
					</div>
					<div class="space-y-2">
						<label for="group-slug" class="text-sm font-medium leading-none">Slug</label>
						<Input
							id="group-slug"
							placeholder="e.g. engineering (optional)"
							bind:value={groupSlug}
						/>
					</div>
					<Dialog.Footer>
						<Button variant="outline" type="button" onclick={() => (dialogOpen = false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!groupName.trim() || creating}>
							{creating ? 'Creating...' : 'Create Group'}
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<!-- Groups table -->
	<div class="rounded-lg border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-[120px]">ID</Table.Head>
					<Table.Head>Name</Table.Head>
					<Table.Head class="w-[120px]">Type</Table.Head>
					<Table.Head class="w-[120px]">Slug</Table.Head>
					<Table.Head class="w-[120px]">Parent</Table.Head>
					<Table.Head class="w-[120px]">Created</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if groups.isLoading}
					{#each Array(5) as _}
						<Table.Row>
							<Table.Cell><div class="cp-skeleton h-3 w-24 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-28 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-5 w-16 rounded-full"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-20 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
							<Table.Cell><div class="cp-skeleton h-3 w-16 rounded"></div></Table.Cell>
						</Table.Row>
					{/each}
				{:else if typedGroups.length === 0}
					<Table.Row>
						<Table.Cell colspan={6}>
							<div class="flex flex-col items-center justify-center py-12 text-center">
								<UsersRound class="size-8 text-muted-foreground mb-2" />
								<p class="text-sm font-medium">No groups found</p>
								<p class="text-sm text-muted-foreground">
									Groups will appear here once created.
								</p>
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each typedGroups as group (group._id)}
						<Table.Row
							class="hover:bg-accent/50 cursor-pointer"
							onclick={() => goto(portalHref(`/groups/${group._id}`))}
						>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{truncateId(group._id)}
							</Table.Cell>
							<Table.Cell class="font-medium">
								{group.name}
							</Table.Cell>
							<Table.Cell>
								{#if group.type}
									<Badge variant="outline">{group.type}</Badge>
								{:else}
									<Badge variant="secondary">untyped</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{group.slug ?? '---'}
							</Table.Cell>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{group.parentGroupId ? truncateId(group.parentGroupId) : 'Root'}
							</Table.Cell>
							<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
								{formatRelative(group._creationTime)}
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</div>
