<script lang="ts">
	import '../app.css';
	import { setupConvex, useConvexClient, useQuery } from 'convex-svelte';
	import { base } from '$app/paths';
	import { api } from '@convex/_generated/api';
	import Sidebar from '$lib/components/layout/sidebar.svelte';
	import Header from '$lib/components/layout/header.svelte';
	import {
		initAuth,
		getIsAuthenticated,
		getIsLoading,
		getInviteToken,
		getFlowState,
		getErrorMessage,
		getInitialized,
		sendMagicLink,
		resetFlow,
		signOut,
		clearInviteToken,
	} from '$lib/stores/auth.svelte';

	// ---- Derive Convex URLs ----

	function deriveConvexUrl(): string {
		if (typeof window === 'undefined') {
			return import.meta.env.VITE_CONVEX_URL ?? 'http://localhost:3210';
		}
		const hostname = window.location.hostname;
		if (hostname.endsWith('.convex.site')) {
			return `https://${hostname.replace('.convex.site', '.convex.cloud')}`;
		}
		if (hostname.endsWith('.convex.cloud')) {
			return window.location.origin;
		}
		return import.meta.env.VITE_CONVEX_URL ?? 'http://localhost:3210';
	}

	const convexUrl = deriveConvexUrl();
	setupConvex(convexUrl);

	// ---- Initialize auth (must be called during component init for context) ----

	const convexClient = useConvexClient();
	initAuth(convexClient);

	// ---- Reactive derived state ----

	const isLoading = $derived(getIsLoading());
	const isAuthenticated = $derived(getIsAuthenticated());
	const inviteToken = $derived(getInviteToken());
	const flowState = $derived(getFlowState());
	const errorMessage = $derived(getErrorMessage());
	const initialized = $derived(getInitialized());

	// ---- Admin check (only when authenticated) ----

	const adminCheck = useQuery(api.auth.portalQuery, () =>
		isAuthenticated ? { action: 'isAdmin' } : 'skip',
	);
	const isAdmin = $derived(adminCheck.data === true);
	const adminCheckDone = $derived(!adminCheck.isLoading && adminCheck.data !== undefined);

	// ---- Invite acceptance (after auth + if invite token exists) ----

	let inviteAccepted = $state(false);
	let inviteAccepting = $state(false);
	let inviteError = $state<string | null>(null);

	$effect(() => {
		// Wait until the admin check query has returned a result — this confirms
		// the server has received our JWT over WebSocket. Without this guard the
		// mutation fires before the token propagates, causing "Not signed in".
		// The `!inviteError` guard prevents an infinite retry loop.
		if (adminCheckDone && !isAdmin && inviteToken && !inviteAccepted && !inviteAccepting && !inviteError) {
			acceptInvite();
		}
	});

	async function acceptInvite() {
		if (!inviteToken) return;
		inviteAccepting = true;
		inviteError = null;
		try {
			const client = useConvexClient();
			// Hash the invite token (SHA-256) to match what the CLI stored
			const encoder = new TextEncoder();
			const data = encoder.encode(inviteToken);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

			await client.mutation(api.auth.portalMutation, { action: 'acceptInvite', tokenHash });
			inviteAccepted = true;
			clearInviteToken();
		} catch (e: any) {
			inviteError = e?.message ?? 'Failed to accept invite';
		} finally {
			inviteAccepting = false;
		}
	}

	// ---- Login form ----

	let email = $state('');

	function getPortalUrl(): string {
		if (typeof window === 'undefined') return '';
		// The portal URL is where the user should be redirected back to
		return window.location.origin + base;
	}

	async function handleSubmitEmail(e: Event) {
		e.preventDefault();
		if (!email.trim()) return;
		await sendMagicLink(email.trim(), getPortalUrl());
	}

	let { children } = $props();
</script>

{#if !initialized || isLoading}
	<!-- Loading state -->
	<div class="flex items-center justify-center h-screen bg-cp-bg">
		<div class="cp-skeleton w-32 h-4 rounded"></div>
	</div>
{:else if !isAuthenticated}
	<!-- Login screen — email magic link -->
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div
			class="max-w-md w-full mx-4 rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-8"
		>
			<!-- Logo / icon -->
			<div
				class="w-12 h-12 rounded-[var(--cp-radius-md)] bg-[rgba(99,168,248,0.1)] border border-[rgba(99,168,248,0.2)] flex items-center justify-center mb-6"
			>
				<svg
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--cp-accent)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
				</svg>
			</div>

			<h1 class="text-[var(--cp-text-lg)] font-semibold mb-1">Admin Portal</h1>

			{#if inviteToken}
				<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-6">
					You've been invited as a portal admin. Enter your email to sign in.
				</p>
			{:else}
				<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-6">
					Sign in with your email to access the auth administration dashboard.
				</p>
			{/if}

			{#if flowState === 'sent'}
				<!-- Check your inbox -->
				<div
					class="rounded-[var(--cp-radius-md)] bg-[rgba(99,168,248,0.08)] border border-[rgba(99,168,248,0.2)] p-4 mb-4"
				>
					<p class="text-[var(--cp-text-sm)] text-[var(--cp-accent)] font-medium mb-1">
						Check your inbox
					</p>
					<p class="text-[var(--cp-text-xs)] text-cp-text-muted leading-relaxed">
						We sent a magic link to <strong class="text-cp-text-secondary">{email}</strong>.
						Click the link in the email to sign in.
					</p>
				</div>

				<button
					onclick={resetFlow}
					class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
				>
					Use a different email
				</button>
			{:else}
				<!-- Email input form -->
				<form onsubmit={handleSubmitEmail} class="space-y-3">
					<div>
						<label for="email" class="block text-[var(--cp-text-xs)] text-cp-text-secondary mb-1.5">
							Email address
						</label>
						<input
							id="email"
							type="email"
							bind:value={email}
							placeholder="admin@example.com"
							required
							class="w-full rounded-[var(--cp-radius-md)] border border-cp-border bg-cp-bg px-3 py-2 text-[var(--cp-text-sm)] text-cp-text placeholder:text-cp-text-muted focus:outline-none focus:border-[var(--cp-accent)] transition-colors"
						/>
					</div>

					{#if flowState === 'error' && errorMessage}
						<div
							class="rounded-[var(--cp-radius-md)] bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)] px-3 py-2"
						>
							<p class="text-[var(--cp-text-xs)] text-[var(--cp-error)]">{errorMessage}</p>
						</div>
					{/if}

					<button
						type="submit"
						disabled={flowState === 'sending' || !email.trim()}
						class="flex items-center justify-center gap-2 w-full rounded-[var(--cp-radius-md)] bg-cp-accent text-[#0a0a0b] font-medium text-[var(--cp-text-sm)] px-4 py-2.5 hover:bg-cp-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{#if flowState === 'sending'}
							<div class="w-4 h-4 border-2 border-[#0a0a0b]/30 border-t-[#0a0a0b] rounded-full animate-spin"></div>
							Sending...
						{:else}
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
								<polyline points="22,6 12,13 2,6" />
							</svg>
							Send magic link
						{/if}
					</button>
				</form>
			{/if}
		</div>
	</div>
{:else if inviteAccepting}
	<!-- Accepting invite -->
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div class="text-center">
			<div class="w-8 h-8 border-2 border-cp-accent/30 border-t-cp-accent rounded-full animate-spin mx-auto mb-4"></div>
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted">Accepting invite...</p>
		</div>
	</div>
{:else if inviteError}
	<!-- Invite error -->
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div class="max-w-md w-full mx-4 rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-8 text-center">
			<div class="w-12 h-12 rounded-full bg-[rgba(248,113,113,0.1)] flex items-center justify-center mx-auto mb-4">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cp-error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10" />
					<line x1="15" y1="9" x2="9" y2="15" />
					<line x1="9" y1="9" x2="15" y2="15" />
				</svg>
			</div>
			<h2 class="text-[var(--cp-text-md)] font-medium mb-2">Invite Error</h2>
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-4">{inviteError}</p>
			<button
				onclick={() => signOut()}
				class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
			>
				Sign out and try again
			</button>
		</div>
	</div>
{:else if !adminCheckDone}
	<!-- Checking admin status -->
	<div class="flex items-center justify-center h-screen bg-cp-bg">
		<div class="cp-skeleton w-32 h-4 rounded"></div>
	</div>
{:else if !isAdmin && ((inviteToken && !inviteError) || inviteAccepted)}
	<!-- Have an invite token pending acceptance, or just accepted and waiting for admin query to refresh -->
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div class="text-center">
			<div class="w-8 h-8 border-2 border-cp-accent/30 border-t-cp-accent rounded-full animate-spin mx-auto mb-4"></div>
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted">
				{inviteAccepted ? 'Setting up admin access...' : 'Accepting invite...'}
			</p>
		</div>
	</div>
{:else if !isAdmin}
	<!-- Not an admin -->
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div class="max-w-md w-full mx-4 rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-8 text-center">
			<div class="w-12 h-12 rounded-full bg-[rgba(252,211,77,0.1)] flex items-center justify-center mx-auto mb-4">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cp-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
					<line x1="12" y1="9" x2="12" y2="13" />
					<line x1="12" y1="17" x2="12.01" y2="17" />
				</svg>
			</div>
			<h2 class="text-[var(--cp-text-md)] font-medium mb-2">Access Denied</h2>
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-4">
				You're signed in but don't have portal admin access.
				Ask an existing admin to generate an invite link.
			</p>
			<button
				onclick={() => signOut()}
				class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
			>
				Sign out
			</button>
		</div>
	</div>
{:else}
	<!-- Authenticated admin — show dashboard -->
	<div class="flex h-screen overflow-hidden bg-cp-bg text-cp-text">
		<Sidebar />

		<div class="flex flex-col flex-1 min-w-0">
			<Header />

			<main class="flex-1 overflow-y-auto p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}
