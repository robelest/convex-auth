<script lang="ts">
	import { page } from '$app/state';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { formatRelative, formatDateTime, truncateId } from '$lib/utils/format';
	import { ArrowLeft, Trash2, UserMinus } from '@lucide/svelte';

	interface GroupData {
		_id: string;
		_creationTime: number;
		name: string;
		slug?: string;
		type?: string;
		parentGroupId?: string;
		extend?: Record<string, unknown>;
	}

	interface GroupMember {
		_id: string;
		userId: string;
		role?: string;
		status?: string;
		_creationTime: number;
	}

	interface GroupInvite {
		_id: string;
		email?: string;
		role?: string;
		status?: string;
		_creationTime: number;
	}

	interface ChildGroup {
		_id: string;
		name: string;
		type?: string;
	}

	const groupId = $derived(page.params.groupId);

	const group = useQuery(api.auth.portalQuery, () => ({ action: 'getGroup', groupId }));
	const members = useQuery(api.auth.portalQuery, () => ({ action: 'getGroupMembers', groupId }));
	const invites = useQuery(api.auth.portalQuery, () => ({ action: 'getGroupInvites', groupId }));

	const typedGroup = $derived(group.data as GroupData | null | undefined);
	const typedMembers = $derived((members.data ?? []) as GroupMember[]);
	const typedInvites = $derived((invites.data ?? []) as GroupInvite[]);
	const childGroups = $derived((typedGroup as any)?.childGroups as ChildGroup[] | undefined);

	const client = useConvexClient();

	async function handleDeleteGroup() {
		if (!confirm('Are you sure you want to delete this group? This action cannot be undone.'))
			return;
		await client.mutation(api.auth.portalMutation, {
			action: 'deleteGroup',
			groupId,
		});
		goto(portalHref('/groups'));
	}

	async function handleRemoveMember(memberId: string) {
		if (!confirm('Remove this member from the group?')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'removeGroupMember',
			groupId,
			memberId,
		});
	}

	function getStatusVariant(
		status: string | undefined
	): 'outline' | 'default' | 'destructive' | 'secondary' {
		switch (status) {
			case 'pending':
				return 'outline';
			case 'accepted':
				return 'default';
			case 'revoked':
				return 'destructive';
			case 'expired':
				return 'secondary';
			default:
				return 'outline';
		}
	}
</script>

<div class="space-y-6">
	<!-- Back button -->
	<button
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
		onclick={() => goto(portalHref('/groups'))}
	>
		<ArrowLeft class="size-4" />
		Back to groups
	</button>

	{#if group.isLoading}
		<!-- Loading skeleton -->
		<Card.Root>
			<Card.Header>
				<div class="space-y-2">
					<div class="cp-skeleton h-5 w-48 rounded"></div>
					<div class="cp-skeleton h-3 w-32 rounded"></div>
				</div>
			</Card.Header>
			<Card.Content>
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					{#each Array(4) as _}
						<div class="space-y-1">
							<div class="cp-skeleton h-3 w-16 rounded"></div>
							<div class="cp-skeleton h-4 w-24 rounded"></div>
						</div>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>
	{:else if !typedGroup}
		<Card.Root>
			<Card.Content class="py-12">
				<div class="flex flex-col items-center justify-center text-center">
					<p class="text-sm font-medium">Group not found</p>
					<p class="text-sm text-muted-foreground mt-1">
						The group ID '{groupId}' does not exist.
					</p>
				</div>
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Group Info Card -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-start justify-between">
					<div class="space-y-1">
						<Card.Title class="text-lg">
							{typedGroup.name}
						</Card.Title>
						<div class="flex items-center gap-2">
							{#if typedGroup.type}
								<Badge variant="outline">{typedGroup.type}</Badge>
							{:else}
								<Badge variant="secondary">untyped</Badge>
							{/if}
							{#if typedGroup.slug}
								<span class="font-mono text-xs text-muted-foreground">
									{typedGroup.slug}
								</span>
							{/if}
						</div>
					</div>
					<Button variant="destructive" size="sm" onclick={handleDeleteGroup}>
						<Trash2 class="size-4" />
						Delete Group
					</Button>
				</div>
			</Card.Header>
			<Card.Content>
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div>
						<dt class="text-xs text-muted-foreground">Group ID</dt>
						<dd class="font-mono text-xs mt-0.5 break-all">{typedGroup._id}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Created</dt>
						<dd class="text-sm mt-0.5">{formatDateTime(typedGroup._creationTime)}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Slug</dt>
						<dd class="font-mono text-xs mt-0.5">{typedGroup.slug ?? '---'}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Parent Group</dt>
						<dd class="font-mono text-xs mt-0.5">
							{typedGroup.parentGroupId ? truncateId(typedGroup.parentGroupId) : 'Root'}
						</dd>
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Members Section -->
		<Card.Root>
			<Card.Header>
				<Card.Title>
					Members
					{#if !members.isLoading}
						<span class="text-sm font-normal text-muted-foreground ml-1">
							({typedMembers.length})
						</span>
					{/if}
				</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if members.isLoading}
					<div class="space-y-3">
						{#each Array(3) as _}
							<div class="cp-skeleton h-10 w-full rounded"></div>
						{/each}
					</div>
				{:else if typedMembers.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No members</p>
						<p class="text-sm text-muted-foreground">
							This group has no members yet.
						</p>
					</div>
				{:else}
					<div class="rounded-lg border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head class="w-[120px]">Member ID</Table.Head>
									<Table.Head class="w-[120px]">User ID</Table.Head>
									<Table.Head class="w-[100px]">Role</Table.Head>
									<Table.Head class="w-[100px]">Status</Table.Head>
									<Table.Head class="w-[120px]">Joined</Table.Head>
									<Table.Head class="w-[60px]"></Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each typedMembers as member (member._id)}
									<Table.Row>
										<Table.Cell class="font-mono text-xs text-muted-foreground">
											{truncateId(member._id)}
										</Table.Cell>
										<Table.Cell>
											<a
												href={portalHref(`/users/${member.userId}`)}
												class="font-mono text-xs text-foreground hover:underline"
											>
												{truncateId(member.userId)}
											</a>
										</Table.Cell>
										<Table.Cell>
											{#if member.role}
												<Badge variant="outline">{member.role}</Badge>
											{:else}
												<span class="text-xs text-muted-foreground">---</span>
											{/if}
										</Table.Cell>
										<Table.Cell>
											{#if member.status}
												<Badge variant={getStatusVariant(member.status)}>
													{member.status}
												</Badge>
											{:else}
												<span class="text-xs text-muted-foreground">---</span>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
											{formatRelative(member._creationTime)}
										</Table.Cell>
										<Table.Cell>
											<Button
												variant="ghost"
												size="icon-sm"
												class="text-muted-foreground hover:text-destructive"
												onclick={() => handleRemoveMember(member._id)}
											>
												<UserMinus class="size-4" />
											</Button>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Invites Section -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Invites</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if invites.isLoading}
					<div class="space-y-3">
						{#each Array(2) as _}
							<div class="cp-skeleton h-10 w-full rounded"></div>
						{/each}
					</div>
				{:else if typedInvites.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No invites</p>
						<p class="text-sm text-muted-foreground">
							No pending invitations for this group.
						</p>
					</div>
				{:else}
					<div class="rounded-lg border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head class="w-[120px]">Invite ID</Table.Head>
									<Table.Head>Email</Table.Head>
									<Table.Head class="w-[100px]">Role</Table.Head>
									<Table.Head class="w-[100px]">Status</Table.Head>
									<Table.Head class="w-[120px]">Created</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each typedInvites as invite (invite._id)}
									<Table.Row>
										<Table.Cell class="font-mono text-xs text-muted-foreground">
											{truncateId(invite._id)}
										</Table.Cell>
										<Table.Cell class="text-sm">
											{invite.email ?? '---'}
										</Table.Cell>
										<Table.Cell>
											{#if invite.role}
												<Badge variant="outline">{invite.role}</Badge>
											{:else}
												<span class="text-xs text-muted-foreground">---</span>
											{/if}
										</Table.Cell>
										<Table.Cell>
											<Badge
												variant={getStatusVariant(invite.status)}
												class={invite.status === 'pending'
													? 'text-yellow-600 dark:text-yellow-500'
													: invite.status === 'accepted'
														? 'bg-green-600 hover:bg-green-600/90 border-transparent text-white'
														: ''}
											>
												{invite.status ?? 'unknown'}
											</Badge>
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
											{formatRelative(invite._creationTime)}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Child Groups Section -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Child Groups</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if !childGroups || childGroups.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No child groups</p>
						<p class="text-sm text-muted-foreground">
							This group has no sub-groups.
						</p>
					</div>
				{:else}
					<div class="divide-y rounded-lg border">
						{#each childGroups as child (child._id)}
							<button
								class="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/50 transition-colors"
								onclick={() => goto(portalHref(`/groups/${child._id}`))}
							>
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium">{child.name}</span>
									{#if child.type}
										<Badge variant="outline" class="text-xs">{child.type}</Badge>
									{/if}
								</div>
								<span class="font-mono text-xs text-muted-foreground">
									{truncateId(child._id)}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
