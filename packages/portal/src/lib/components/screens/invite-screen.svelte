<script lang="ts">
	import Icon from '$lib/components/ui/icon.svelte';
	import { signOut } from '$lib/stores/auth.svelte';

	interface Props {
		state: 'accepting' | 'accepted' | 'error';
		error: string | null;
	}

	let { state, error }: Props = $props();
</script>

{#if state === 'error'}
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div class="max-w-md w-full mx-4 rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-8 text-center">
			<div class="w-12 h-12 rounded-full bg-[rgba(248,113,113,0.1)] flex items-center justify-center mx-auto mb-4">
				<Icon name="error" size={24} color="var(--cp-error)" />
			</div>
			<h2 class="text-[var(--cp-text-md)] font-medium mb-2">Invite Error</h2>
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-4">{error ?? 'Unknown error'}</p>
			<button
				onclick={() => signOut()}
				class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
			>
				Sign out and try again
			</button>
		</div>
	</div>
{:else}
	<!-- accepting or accepted (waiting for admin query to refresh) -->
	<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
		<div class="text-center">
			<div class="w-8 h-8 border-2 border-cp-accent/30 border-t-cp-accent rounded-full animate-spin mx-auto mb-4"></div>
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted">
				{state === 'accepted' ? 'Setting up admin access...' : 'Accepting invite...'}
			</p>
		</div>
	</div>
{/if}
