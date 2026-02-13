<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		children: Snippet;
		actions?: Snippet;
	}

	let { title, children, actions }: Props = $props();
</script>

<div class="rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary">
	{#if title || actions}
		<div class="flex items-center justify-between px-4 py-3 border-b border-cp-border">
			{#if title}
				<h2 class="text-[var(--cp-text-sm)] font-medium text-cp-text">{title}</h2>
			{/if}
			{#if actions}
				<div class="flex items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}
	<div>
		{@render children()}
	</div>
</div>
