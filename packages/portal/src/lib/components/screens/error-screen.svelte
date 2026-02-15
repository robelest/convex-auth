<script lang="ts">
	import { CircleX, TriangleAlert } from '@lucide/svelte';
	import { signOut } from '$lib/stores/auth.svelte';

	interface Props {
		title: string;
		message: string;
		icon?: 'error' | 'warning';
		iconColor?: string;
		iconBg?: string;
	}

	let {
		title,
		message,
		icon = 'error',
		iconColor = 'var(--cp-error)',
		iconBg = 'rgba(248,113,113,0.1)',
	}: Props = $props();
</script>

<div class="flex items-center justify-center h-screen bg-background text-foreground">
	<div class="max-w-md w-full mx-4 rounded-lg border bg-card p-8 text-center">
		<div
			class="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
			style="background: {iconBg};"
		>
			{#if icon === 'warning'}
				<TriangleAlert size={24} color={iconColor} />
			{:else}
				<CircleX size={24} color={iconColor} />
			{/if}
		</div>
		<h2 class="text-[var(--cp-text-md)] font-medium mb-2">{title}</h2>
		<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-4">{message}</p>
		<button
			onclick={() => signOut()}
			class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
		>
			Sign out and try again
		</button>
	</div>
</div>
