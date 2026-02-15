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
	import { formatRelative, formatDateTime, truncateId, isSessionExpired } from '$lib/utils/format';
	import { ArrowLeft, Trash2, Ban } from '@lucide/svelte';

	const userId = $derived(page.params.userId);

	const user = useQuery(api.auth.portalQuery, () => ({ action: 'getUser', userId }));
	const sessions = useQuery(api.auth.portalQuery, () => ({ action: 'getUserSessions', userId }));
	const accounts = useQuery(api.auth.portalQuery, () => ({ action: 'getUserAccounts', userId }));
	const userKeys = useQuery(api.auth.portalQuery, () => ({ action: 'getUserKeys', userId }));
	const userGroups = useQuery(api.auth.portalQuery, () => ({ action: 'getUserGroups', userId }));

	const client = useConvexClient();

	async function handleRevokeSession(sessionId: string) {
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeSession',
			sessionId,
		});
	}

	async function handleRevokeKey(keyId: string) {
		if (!confirm('Revoke this API key?')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeKey',
			keyId,
		});
	}

	async function handleDeleteKey(keyId: string) {
		if (!confirm('Permanently delete this API key?')) return;
		await client.mutation(api.auth.portalMutation, {
			action: 'deleteKey',
			keyId,
		});
	}

	function getProviderLabel(provider: string): string {
		const labels: Record<string, string> = {
			password: 'Password',
			'oauth-google': 'Google',
			'oauth-github': 'GitHub',
			'oauth-apple': 'Apple',
			'magic-link': 'Magic Link',
			otp: 'OTP',
			passkey: 'Passkey',
		};
		return labels[provider] ?? provider;
	}

	function getKeyStatus(key: any): 'active' | 'revoked' | 'expired' {
		if (key.revoked) return 'revoked';
		if (key.expiresAt && Date.now() > key.expiresAt) return 'expired';
		return 'active';
	}

	function formatScopes(scopes: Array<{ resource: string; actions: string[] }>): string {
		if (!scopes || scopes.length === 0) return 'No scopes';
		return scopes.map((s: any) => `${s.resource}:${s.actions.join(',')}`).join('; ');
	}
</script>

<div class="space-y-6">
	<!-- Back button -->
	<Button variant="ghost" size="sm" onclick={() => goto(portalHref('/users'))}>
		<ArrowLeft class="size-4" />
		Back to users
	</Button>

	{#if user.isLoading}
		<!-- Loading skeleton -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center gap-4">
					<div class="h-12 w-12 animate-pulse rounded-full bg-muted"></div>
					<div class="space-y-2">
						<div class="h-4 w-32 animate-pulse rounded bg-muted"></div>
						<div class="h-3 w-48 animate-pulse rounded bg-muted"></div>
					</div>
				</div>
			</Card.Header>
		</Card.Root>
	{:else if !user.data}
		<Card.Root>
			<Card.Content>
				<div class="flex flex-col items-center justify-center py-12 text-center">
					<p class="text-sm font-medium">User not found</p>
					<p class="text-sm text-muted-foreground">The user ID '{userId}' does not exist.</p>
				</div>
			</Card.Content>
		</Card.Root>
	{:else}
		{@const u = user.data}

		<!-- Profile Card -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-start justify-between w-full">
					<div class="flex items-center gap-4">
						{#if u.image}
							<img src={u.image} alt="" class="h-12 w-12 rounded-full object-cover" />
						{:else}
							<div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground">
								{(u.name ?? u.email ?? '?')[0]?.toUpperCase()}
							</div>
						{/if}
						<div>
							<Card.Title>{u.name ?? 'Unnamed User'}</Card.Title>
							<div class="mt-1 flex items-center gap-2">
								{#if u.email}
									<span class="text-sm text-muted-foreground">{u.email}</span>
								{/if}
								{#if u.phone}
									<span class="text-sm text-muted-foreground">{u.phone}</span>
								{/if}
							</div>
						</div>
					</div>
					<div>
						{#if u.isAnonymous}
							<Badge variant="secondary">Anonymous</Badge>
						{:else if u.emailVerificationTime}
							<Badge variant="default" class="bg-green-600 hover:bg-green-600/90 border-transparent">Verified</Badge>
						{:else}
							<Badge variant="outline" class="text-yellow-600 dark:text-yellow-500">Unverified</Badge>
						{/if}
					</div>
				</div>
			</Card.Header>
			<Card.Content>
				<Separator class="mb-4" />
				<dl class="grid grid-cols-2 gap-4 md:grid-cols-4">
					<div>
						<dt class="text-xs text-muted-foreground">User ID</dt>
						<dd class="mt-0.5 break-all font-mono text-xs">{u._id}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Created</dt>
						<dd class="mt-0.5 text-sm text-muted-foreground">{formatDateTime(u._creationTime)}</dd>
					</div>
					{#if u.emailVerificationTime}
						<div>
							<dt class="text-xs text-muted-foreground">Email Verified</dt>
							<dd class="mt-0.5 text-sm text-muted-foreground">{formatDateTime(u.emailVerificationTime)}</dd>
						</div>
					{/if}
					{#if u.phoneVerificationTime}
						<div>
							<dt class="text-xs text-muted-foreground">Phone Verified</dt>
							<dd class="mt-0.5 text-sm text-muted-foreground">{formatDateTime(u.phoneVerificationTime)}</dd>
						</div>
					{/if}
				</dl>
			</Card.Content>
		</Card.Root>

		<!-- Linked Accounts -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Linked Accounts</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if accounts.isLoading}
					<div class="space-y-2">
						<div class="h-4 w-48 animate-pulse rounded bg-muted"></div>
						<div class="h-4 w-36 animate-pulse rounded bg-muted"></div>
					</div>
				{:else if !accounts.data || accounts.data.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No linked accounts</p>
						<p class="text-sm text-muted-foreground">This user has no authentication accounts.</p>
					</div>
				{:else}
					<div class="rounded-lg border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Provider</Table.Head>
									<Table.Head>Account ID</Table.Head>
									<Table.Head class="w-[120px]">Created</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each accounts.data as account}
									<Table.Row>
										<Table.Cell>
											<Badge variant="secondary">{getProviderLabel(account.provider)}</Badge>
										</Table.Cell>
										<Table.Cell class="font-mono text-xs text-muted-foreground">
											{account.providerAccountId}
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
											{formatRelative(account._creationTime)}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Sessions -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Sessions</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if sessions.isLoading}
					<div class="space-y-2">
						<div class="h-4 w-48 animate-pulse rounded bg-muted"></div>
						<div class="h-4 w-36 animate-pulse rounded bg-muted"></div>
					</div>
				{:else if !sessions.data || sessions.data.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No sessions</p>
						<p class="text-sm text-muted-foreground">This user has no active sessions.</p>
					</div>
				{:else}
					<div class="rounded-lg border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Session ID</Table.Head>
									<Table.Head class="w-[100px]">Status</Table.Head>
									<Table.Head class="w-[120px]">Created</Table.Head>
									<Table.Head class="w-[120px]">Expires</Table.Head>
									<Table.Head class="w-[80px] text-right">Actions</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each sessions.data as session}
									<Table.Row>
										<Table.Cell class="font-mono text-xs text-muted-foreground">
											{truncateId(session._id)}
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
													variant="ghost"
													size="icon-sm"
													onclick={() => handleRevokeSession(session._id)}
												>
													<Ban class="size-4 text-destructive" />
												</Button>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- API Keys -->
		<Card.Root>
			<Card.Header>
				<Card.Title>API Keys</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if userKeys.isLoading}
					<div class="space-y-2">
						<div class="h-4 w-48 animate-pulse rounded bg-muted"></div>
						<div class="h-4 w-36 animate-pulse rounded bg-muted"></div>
					</div>
				{:else if !userKeys.data || userKeys.data.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No API keys</p>
						<p class="text-sm text-muted-foreground">This user has no API keys.</p>
					</div>
				{:else}
					<div class="rounded-lg border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Name</Table.Head>
									<Table.Head>Key Prefix</Table.Head>
									<Table.Head class="w-[100px]">Status</Table.Head>
									<Table.Head>Scopes</Table.Head>
									<Table.Head class="w-[120px]">Created</Table.Head>
									<Table.Head class="w-[100px] text-right">Actions</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each userKeys.data as key}
									{@const status = getKeyStatus(key)}
									<Table.Row>
										<Table.Cell class="font-medium">
											{key.name}
										</Table.Cell>
										<Table.Cell class="font-mono text-xs text-muted-foreground">
											{key.prefix}
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
										<Table.Cell class="text-xs text-muted-foreground" title={formatScopes(key.scopes)}>
											{key.scopes?.length ?? 0} scope{(key.scopes?.length ?? 0) !== 1 ? 's' : ''}
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
											{formatRelative(key._creationTime)}
										</Table.Cell>
										<Table.Cell class="text-right">
											<div class="flex items-center justify-end gap-1">
												{#if status === 'active'}
													<Button
														variant="ghost"
														size="icon-sm"
														onclick={() => handleRevokeKey(key._id)}
													>
														<Ban class="size-4 text-destructive" />
													</Button>
												{/if}
												<Button
													variant="ghost"
													size="icon-sm"
													onclick={() => handleDeleteKey(key._id)}
												>
													<Trash2 class="size-4 text-destructive" />
												</Button>
											</div>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Group Memberships -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Group Memberships</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if userGroups.isLoading}
					<div class="space-y-2">
						<div class="h-4 w-48 animate-pulse rounded bg-muted"></div>
						<div class="h-4 w-36 animate-pulse rounded bg-muted"></div>
					</div>
				{:else if !userGroups.data || userGroups.data.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-center">
						<p class="text-sm font-medium">No group memberships</p>
						<p class="text-sm text-muted-foreground">This user is not a member of any groups.</p>
					</div>
				{:else}
					<div class="rounded-lg border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Group</Table.Head>
									<Table.Head class="w-[100px]">Role</Table.Head>
									<Table.Head class="w-[100px]">Status</Table.Head>
									<Table.Head class="w-[120px]">Joined</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each userGroups.data as membership}
									<Table.Row>
										<Table.Cell>
											{#if membership.group}
												<a
													href={portalHref(`/groups/${membership.groupId}`)}
													class="font-medium text-primary hover:underline"
												>
													{membership.group.name}
												</a>
												{#if membership.group.type}
													<Badge variant="outline" class="ml-2 text-xs">{membership.group.type}</Badge>
												{/if}
											{:else}
												<span class="font-mono text-xs text-muted-foreground">{truncateId(membership.groupId)}</span>
											{/if}
										</Table.Cell>
										<Table.Cell>
											{#if membership.role}
												<Badge variant="secondary">{membership.role}</Badge>
											{:else}
												<span class="text-xs text-muted-foreground">—</span>
											{/if}
										</Table.Cell>
										<Table.Cell>
											{#if membership.status === 'active' || !membership.status}
												<Badge variant="default" class="bg-green-600 hover:bg-green-600/90 border-transparent">Active</Badge>
											{:else}
												<Badge variant="secondary">{membership.status}</Badge>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground whitespace-nowrap">
											{formatRelative(membership._creationTime)}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
