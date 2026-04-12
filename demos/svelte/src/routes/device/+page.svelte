<script lang="ts">
	import { page } from '$app/state';
	import { getContext } from 'svelte';

	import AuthModal from '$lib/components/AuthModal.svelte';

	let { data } = $props();

	type AuthContext = {
		device: {
			verify: (opts: { code: string }) => Promise<void>;
		};
	};

	const auth = getContext<AuthContext>('auth');
	let code = $state(page.url.searchParams.get('code') ?? '');
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let isSubmitting = $state(false);

	async function handleVerify() {
		if (!code.trim()) return;
		isSubmitting = true;
		errorMessage = null;
		successMessage = null;
		try {
			await auth.device.verify({ code: code.trim() });
			successMessage = 'Device approved. You can return to your terminal.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to approve device.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if !data.auth.isAuthenticated}
	<div class="flex w-full max-w-80 flex-col gap-3">
		<p class="muted text-center">Sign in to approve a device code.</p>
		<AuthModal authProviders={data.authProviders} />
	</div>
{:else}
	<div class="flex w-full max-w-80 flex-col gap-3 border border-gray-300 bg-white p-5 max-md:max-w-full max-md:p-4 max-md:border-x-0">
		<h2 class="heading text-xl m-0">Approve device</h2>
		<p class="muted m-0">Enter the code shown in your terminal to complete device sign-in.</p>
		<form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); handleVerify(); }}>
			<input
				bind:value={code}
				class="input"
				type="text"
				placeholder="WDJB-MJHT"
				autocomplete="one-time-code"
			/>
			<button class="button button--accent button--block" disabled={isSubmitting || !code.trim()} type="submit">
				{isSubmitting ? 'Approving...' : 'Approve device'}
			</button>
		</form>

		{#if successMessage}
			<p class="font-label text-[0.75rem] text-green-700 m-0">{successMessage}</p>
		{/if}

		{#if errorMessage}
			<p class="error-banner">{errorMessage}</p>
		{/if}
	</div>
{/if}
