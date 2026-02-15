<script lang="ts">
	import '../app.css';
	import { untrack } from 'svelte';
	import { setupConvex, useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '@convex/_generated/api';
	import Sidebar from '$lib/components/layout/sidebar.svelte';

	import LoadingScreen from '$lib/components/screens/loading.svelte';
	import LoginScreen from '$lib/components/screens/login-screen.svelte';
	import InviteScreen from '$lib/components/screens/invite-screen.svelte';
	import AccessDeniedScreen from '$lib/components/screens/access-denied-screen.svelte';
	import SpinnerScreen from '$lib/components/screens/spinner-screen.svelte';
	import {
		auth,
		initAuth,
		acceptInvite,
	} from '$lib/stores/auth.svelte';

	// ---- Load data (from +layout.ts) ----

	const { data, children } = $props();

	// Capture discovery once — the load function resolves it before mount
	// and it never changes. Use untrack to avoid Svelte warning about
	// reading reactive props outside a reactive context.
	const discovery = untrack(() => data.discovery);
	const hasConvex = !!discovery;

	// ---- Convex setup (only if we have a URL) ----
	// setupConvex + useConvexClient must be called synchronously during
	// component init (they use Svelte context). Safe because the load
	// function has already resolved `discovery` before this component mounts.

	if (discovery) {
		setupConvex(discovery.url);
		const convex = useConvexClient();
		initAuth(convex);

		if (discovery.config) {
			auth.serverConfig = discovery.config;
		}
		if (discovery.slug) {
			auth.slug = discovery.slug;
		}
	}

	// ---- Derived auth primitives ----

	const isLoading = $derived(!auth.initialized || auth.state.isLoading);
	const isAuthenticated = $derived(auth.state.isAuthenticated);

	// ---- Admin check (only when authenticated) ----

	const adminCheck = useQuery(api.auth.portalQuery, () =>
		hasConvex && isAuthenticated ? { action: 'isAdmin' } : 'skip',
	);
	const isAdmin = $derived(adminCheck.data === true);
	const adminCheckDone = $derived(!adminCheck.isLoading && adminCheck.data !== undefined);

	// ---- Invite acceptance trigger ----
	// Fires once when: authenticated + admin check done + not admin + invite pending

	$effect(() => {
		if (
			adminCheckDone &&
			!isAdmin &&
			auth.inviteState === 'pending'
		) {
			acceptInvite(api.auth.portalMutation);
		}
	});

	// ---- Screen discriminant (state machine) ----

	type Screen =
		| 'loading'
		| 'login'
		| 'invite'
		| 'checking-admin'
		| 'access-denied'
		| 'dashboard';

	const screen: Screen = $derived.by(() => {
		if (!hasConvex) return 'loading'; // redirect in progress
		if (isLoading) return 'loading';
		if (!isAuthenticated) return 'login';

		// Authenticated — handle invite flow
		const inv = auth.inviteState;
		if (inv === 'accepting' || inv === 'accepted' || inv === 'error') return 'invite';
		if (inv === 'pending') return 'invite'; // waiting for $effect to trigger

		// No invite — check admin status
		if (!adminCheckDone) return 'checking-admin';
		if (!isAdmin) return 'access-denied';

		return 'dashboard';
	});
</script>

{#if screen === 'loading'}
	<LoadingScreen />

{:else if screen === 'login'}
	<LoginScreen inviteToken={auth.inviteToken} />

{:else if screen === 'invite'}
	<InviteScreen state={auth.inviteState === 'error' ? 'error' : auth.inviteState === 'accepted' ? 'accepted' : 'accepting'} error={auth.inviteError} />

{:else if screen === 'checking-admin'}
	<SpinnerScreen message="Verifying admin access..." />

{:else if screen === 'access-denied'}
	<AccessDeniedScreen />

{:else}
	<!-- dashboard -->
	<div class="flex h-screen overflow-hidden bg-background text-foreground">
		<Sidebar />
		<main class="flex-1 min-w-0 overflow-y-auto p-6">
			{@render children()}
		</main>
	</div>
{/if}
