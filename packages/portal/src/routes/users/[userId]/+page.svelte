<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import Badge from '$lib/components/ui/badge.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { formatDateTime, formatRelative, isSessionExpired, truncateId } from '$lib/utils/format';

	const userId = $derived(page.params.userId);

	const user = useQuery(api.auth.portalQuery, () => ({ action: 'getUser', userId }));
	const sessions = useQuery(api.auth.portalQuery, () => ({ action: 'getUserSessions', userId }));
	const accounts = useQuery(api.auth.portalQuery, () => ({ action: 'getUserAccounts', userId }));
	const client = useConvexClient();

	async function handleRevokeSession(sessionId: string) {
		await client.mutation(api.auth.portalMutation, {
			action: 'revokeSession',
			sessionId,
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

	function getProviderVariant(provider: string): 'accent' | 'info' | 'success' | 'muted' {
		if (provider.startsWith('oauth-')) return 'accent';
		if (provider === 'passkey') return 'info';
		if (provider === 'password') return 'success';
		return 'muted';
	}
</script>

<div class="space-y-4">
	<!-- Back link -->
	<a
		href="{base}/users"
		class="inline-flex items-center gap-1 text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
	>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="15 18 9 12 15 6"/>
		</svg>
		Back to users
	</a>

	{#if user.isLoading}
		<!-- Loading skeleton -->
		<div class="space-y-4">
			<div class="rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-4">
				<div class="flex items-center gap-3">
					<div class="cp-skeleton w-10 h-10 rounded-full"></div>
					<div class="space-y-2">
						<div class="cp-skeleton w-32 h-4 rounded"></div>
						<div class="cp-skeleton w-48 h-3 rounded"></div>
					</div>
				</div>
			</div>
		</div>
	{:else if !user.data}
		<EmptyState title="User not found" description="The user ID '{userId}' does not exist." icon="users" />
	{:else}
		{@const u = user.data}
		<!-- User profile card -->
		<div class="rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-4">
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-3">
					{#if u.image}
						<img src={u.image} alt="" class="w-10 h-10 rounded-full" />
					{:else}
						<div class="w-10 h-10 rounded-full bg-cp-bg-tertiary flex items-center justify-center text-[var(--cp-text-md)] text-cp-text-muted">
							{(u.name ?? u.email ?? '?')[0]?.toUpperCase()}
						</div>
					{/if}
					<div>
						<h2 class="text-[var(--cp-text-md)] font-medium text-cp-text">
							{u.name ?? 'Unnamed User'}
						</h2>
						<div class="flex items-center gap-2 mt-0.5">
							{#if u.email}
								<span class="text-[var(--cp-text-sm)] text-cp-text-secondary">{u.email}</span>
							{/if}
							{#if u.phone}
								<span class="text-[var(--cp-text-sm)] text-cp-text-secondary">{u.phone}</span>
							{/if}
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2">
					{#if u.isAnonymous}
						<Badge variant="muted">Anonymous</Badge>
					{:else if u.emailVerificationTime}
						<Badge variant="success">Verified</Badge>
					{:else}
						<Badge variant="warning">Unverified</Badge>
					{/if}
				</div>
			</div>

			<!-- Metadata grid -->
			<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-cp-border">
				<div>
					<dt class="text-[var(--cp-text-xs)] text-cp-text-muted">User ID</dt>
					<dd class="font-mono text-[var(--cp-text-xs)] text-cp-text-secondary mt-0.5 break-all">{u._id}</dd>
				</div>
				<div>
					<dt class="text-[var(--cp-text-xs)] text-cp-text-muted">Created</dt>
					<dd class="text-[var(--cp-text-sm)] text-cp-text-secondary mt-0.5">{formatDateTime(u._creationTime)}</dd>
				</div>
				{#if u.emailVerificationTime}
					<div>
						<dt class="text-[var(--cp-text-xs)] text-cp-text-muted">Email Verified</dt>
						<dd class="text-[var(--cp-text-sm)] text-cp-text-secondary mt-0.5">{formatDateTime(u.emailVerificationTime)}</dd>
					</div>
				{/if}
				{#if u.phoneVerificationTime}
					<div>
						<dt class="text-[var(--cp-text-xs)] text-cp-text-muted">Phone Verified</dt>
						<dd class="text-[var(--cp-text-sm)] text-cp-text-secondary mt-0.5">{formatDateTime(u.phoneVerificationTime)}</dd>
					</div>
				{/if}
			</div>
		</div>

		<!-- Linked Accounts -->
		<Card title="Linked Accounts">
			{#if accounts.isLoading}
				<div class="px-4 py-3"><div class="cp-skeleton h-4 w-48 rounded"></div></div>
			{:else if !accounts.data || accounts.data.length === 0}
				<EmptyState title="No linked accounts" description="This user has no authentication accounts." />
			{:else}
				<div class="divide-y divide-cp-border/50">
					{#each accounts.data as account}
						<div class="flex items-center justify-between px-4 py-3">
							<div class="flex items-center gap-3">
								<Badge variant={getProviderVariant(account.provider)}>
									{getProviderLabel(account.provider)}
								</Badge>
								<span class="font-mono text-[var(--cp-text-xs)] text-cp-text-secondary">
									{account.providerAccountId}
								</span>
							</div>
							<span class="text-[var(--cp-text-xs)] text-cp-text-muted">
								{formatRelative(account._creationTime)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</Card>

		<!-- Sessions -->
		<Card title="Sessions">
			{#if sessions.isLoading}
				<div class="px-4 py-3"><div class="cp-skeleton h-4 w-48 rounded"></div></div>
			{:else if !sessions.data || sessions.data.length === 0}
				<EmptyState title="No sessions" description="This user has no active sessions." icon="sessions" />
			{:else}
				<div class="divide-y divide-cp-border/50">
					{#each sessions.data as session}
						<div class="flex items-center justify-between px-4 py-3">
							<div class="flex items-center gap-3">
								<span class="font-mono text-[var(--cp-text-xs)] text-cp-text-muted">
									{truncateId(session._id)}
								</span>
								{#if isSessionExpired(session.expirationTime)}
									<Badge variant="error">Expired</Badge>
								{:else}
									<Badge variant="success">Active</Badge>
								{/if}
							</div>
							<div class="flex items-center gap-3">
								<span class="text-[var(--cp-text-xs)] text-cp-text-muted">
									Expires {formatRelative(session.expirationTime)}
								</span>
								{#if !isSessionExpired(session.expirationTime)}
									<Button variant="danger" size="sm" onclick={() => handleRevokeSession(session._id)}>
										Revoke
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card>
	{/if}
</div>
