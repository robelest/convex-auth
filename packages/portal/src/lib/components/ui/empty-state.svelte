<script lang="ts">
	import Icon from '$lib/components/ui/icon.svelte';

	interface Props {
		title: string;
		description?: string;
		icon?: 'users' | 'sessions' | 'keys';
	}

	let { title, description, icon }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 px-4 text-center">
	{#if icon}
		<Icon name={icon} size={32} strokeWidth={1.5} class="text-cp-text-muted mb-3" />
	{/if}

	<h3 class="text-[var(--cp-text-sm)] font-medium text-cp-text-secondary">{title}</h3>
	{#if description}
		<p class="text-[var(--cp-text-xs)] text-cp-text-muted mt-1 max-w-xs">{description}</p>
	{/if}
</div>
