<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api.js';
	import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';

	type AuthContext = {
		invite?: { email?: string } | null;
		signIn: (provider: string, args?: Record<string, unknown>) => Promise<{
			kind: 'signedIn' | 'redirect';
			redirect?: URL | string;
		}>;
		passkey?: {
			isSupported: () => boolean;
			authenticate: (opts?: Record<string, unknown>) => Promise<{
				kind: 'signedIn' | 'redirect';
				redirect?: URL | string;
			}>;
		};
	};

	let { authProviders } = $props<{
		authProviders: { google: boolean };
	}>();

	const auth = getContext<AuthContext>('auth');
	const convexClient = useConvexClient();

	let errorMessage: string | null = $state(null);
	let isSubmitting: boolean = $state(false);
	let password: string = $state('');

	// Invite state from auth client (SSR-safe, auto-persisted before redirects)
	const isInvite = Boolean(auth.invite);
	const prefillEmail = auth.invite?.email ?? '';
	let email: string = $state(prefillEmail);

	let mode: 'signIn' | 'signUp' = $state('signIn');
	let step: 'email' | 'password' | 'checking' = $state('email');
	const passkeySupported = $derived(auth.passkey?.isSupported() ?? false);

	function getErrorMessage(error: unknown) {
		if (error instanceof Error) {
			return error.message;
		}
		return String(error);
	}

	function isNoMatchingSsoError(error: unknown) {
		const message = getErrorMessage(error);
		return message.includes('No group connection matched the provided input.');
	}

	onMount(() => {
		if (!isInvite || !prefillEmail || step !== 'email') {
			return;
		}

		step = 'checking';
		void convexClient
			.query(api.groups.checkEmailExists, { email: prefillEmail })
			.then((exists: boolean) => {
				mode = exists ? 'signIn' : 'signUp';
				step = 'password';
			})
			.catch(() => {
				mode = 'signUp';
				step = 'password';
			});
	});

	async function handleEmailContinue() {
		if (!email.includes('@')) return;
		isSubmitting = true;
		errorMessage = null;

		let shouldFallbackToPassword = false;

		// Try SSO first
		try {
			console.log('[group-sso] lookup:start', { email });
			const ssoInfo = await convexClient.query(api.auth.group.signIn, { email });
			console.log('[group-sso] lookup:result', ssoInfo);
			console.log('[group-sso] signin:start', {
				connectionId: ssoInfo.connectionId,
				protocol: ssoInfo.protocol,
				signInPath: ssoInfo.signInPath,
			});
			const result = await auth.signIn('sso', { connectionId: ssoInfo.connectionId });
			console.log('[group-sso] signin:result', result);
			if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
				return;
			}
			window.location.reload();
			return;
		} catch (error) {
			console.error('[group-sso] flow:failed', error);
			if (!isNoMatchingSsoError(error)) {
				errorMessage = getErrorMessage(error);
				isSubmitting = false;
				return;
			}
			shouldFallbackToPassword = true;
		}

		if (shouldFallbackToPassword) {
			try {
				const exists = await convexClient.query(api.groups.checkEmailExists, { email });
				mode = exists ? 'signIn' : 'signUp';
			} catch {
				// Default to sign-in
			}

			isSubmitting = false;
			step = 'password';
		}
	}

	async function handlePasswordSubmit() {
		isSubmitting = true;
		errorMessage = null;

		try {
			const result = await auth.signIn('password', { flow: mode, email, password });
			if (result.kind === 'signedIn') {
				window.location.reload();
			} else if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Something went wrong';
			if (msg.includes('Invalid credentials') || msg.includes('credentials')) {
				errorMessage = 'Wrong password. Try again.';
			} else {
				errorMessage = msg;
			}
		} finally {
			isSubmitting = false;
		}
	}

	async function handleGoogleSignIn() {
		isSubmitting = true;
		errorMessage = null;

		try {
			const result = await auth.signIn('google');
			if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			} else if (result.kind === 'signedIn') {
				window.location.reload();
			}
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			isSubmitting = false;
		}
	}

	async function handlePasskeySignIn() {
		if (!auth.passkey) return;
		isSubmitting = true;
		errorMessage = null;

		try {
			const result = await auth.passkey.authenticate();
			if (result.kind === 'redirect' && result.redirect) {
				window.location.href = result.redirect.toString();
			} else if (result.kind === 'signedIn') {
				window.location.reload();
			}
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			isSubmitting = false;
		}
	}

	function goBackToEmail() {
		step = 'email';
		password = '';
		errorMessage = null;
	}
</script>

<div class="flex w-full max-w-80 flex-col gap-3 border border-gray-300 bg-white p-5 max-md:max-w-full max-md:p-4 max-md:border-x-0">
	{#if isInvite}
		<p class="font-label text-[0.6875rem] text-accent-500 m-0">You've been invited to an organization</p>
	{/if}
	<h2 class="heading text-xl m-0">
		{#if step === 'checking'}
			Loading...
		{:else}
			{mode === 'signIn' ? 'Sign in' : 'Create account'}
		{/if}
	</h2>

	{#if step === 'checking'}
		<p class="muted">Checking your account...</p>

	{:else if step === 'email'}
		{#if passkeySupported}
			<button
				class="button button--secondary button--block"
				disabled={isSubmitting}
				onclick={handlePasskeySignIn}
			>Continue with passkey</button>
			<div class="divider"><span>or</span></div>
		{/if}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleEmailContinue(); }}>
			<input
				bind:value={email}
				class="input"
				type="email"
				placeholder="Email"
				autocomplete="email"
			/>
			<button class="button button--accent button--block" disabled={isSubmitting || !email.includes('@')} type="submit">
				{isSubmitting ? 'Checking...' : 'Continue'}
			</button>
		</form>

	{:else}
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handlePasswordSubmit(); }}>
			{#if !isInvite}
				<button
					class="flex items-center gap-1 font-label text-[0.75rem] text-gray-500 text-left bg-transparent border-0 p-0 cursor-pointer hover:text-accent-600"
					type="button"
					onclick={goBackToEmail}
				><ArrowLeft size={14} />{email}</button>
			{:else}
				<span class="font-label text-[0.75rem] text-gray-500">{email}</span>
			{/if}
			<input
				bind:value={password}
				class="input"
				type="password"
				placeholder={mode === 'signIn' ? 'Password' : 'Choose a password'}
				autocomplete={mode === 'signIn' ? 'current-password' : 'new-password'}
			/>
			<button class="button button--accent button--block" disabled={isSubmitting} type="submit">
				{#if isSubmitting}
					{mode === 'signIn' ? 'Signing in...' : 'Creating account...'}
				{:else}
					{mode === 'signIn' ? 'Sign in' : 'Create account'}
				{/if}
			</button>
		</form>
	{/if}

	{#if authProviders.google && step !== 'checking'}
		<div class="divider"><span>or</span></div>
		<button
			class="button button--secondary button--block"
			disabled={isSubmitting}
			onclick={handleGoogleSignIn}
		>Continue with Google</button>
	{/if}

	{#if !isInvite && step !== 'checking'}
		<p class="font-label text-[0.75rem] text-gray-500 text-center m-0 mt-1">
			{#if mode === 'signIn'}
				Don't have an account?
				<button class="bg-transparent border-0 p-0 font-label text-[0.75rem] font-semibold text-accent-500 hover:text-accent-600 cursor-pointer" onclick={() => { mode = 'signUp'; }}>Sign up</button>
			{:else}
				Already have an account?
				<button class="bg-transparent border-0 p-0 font-label text-[0.75rem] font-semibold text-accent-500 hover:text-accent-600 cursor-pointer" onclick={() => { mode = 'signIn'; }}>Sign in</button>
			{/if}
		</p>
	{/if}

	{#if errorMessage}
		<p class="error-banner">{errorMessage}</p>
	{/if}
</div>
