<script lang="ts">
	import { page } from '$app/state';
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { errorText } from '$lib/errors';
	import type { AppContext } from '$lib/app';
	import AuthModal from '$lib/components/AuthModal.svelte';

	type AuthContext = {
		device: {
			verify: (opts: { code: string }) => Promise<void>;
		};
	};

	const auth = getContext<AuthContext>('auth');
	const app = getContext<AppContext>('app');
	let code = $state(page.url.searchParams.get('code') ?? '');
	let isSubmitting = $state(false);

	async function handleVerify() {
		if (!code.trim()) return;
		isSubmitting = true;
		try {
			await auth.device.verify({ code: code.trim() });
			toast.success('Device approved. You can return to your terminal.');
		} catch (error) {
			toast.error(errorText(error, 'Failed to approve device.'));
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if !app.isAuthenticated}
	<div class="flex w-full max-w-80 flex-col gap-3">
		<p class="muted text-center">Sign in to approve a device code.</p>
		<AuthModal authProviders={app.authProviders} />
	</div>
{:else}
	<div class="panel panel--raised flex w-full max-w-80 flex-col gap-3 border-t-[3px] border-t-brand-red p-5 max-md:max-w-full max-md:p-4 max-md:border-x-0">
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
	</div>
{/if}
