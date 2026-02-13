<script lang="ts">
	interface Props {
		title: string;
		description?: string;
		icon?: 'users' | 'sessions';
	}

	let { title, description, icon }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 px-4 text-center">
	{#if icon === 'users'}
		<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-cp-text-muted mb-3">
			<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
			<circle cx="9" cy="7" r="4"/>
			<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
			<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
		</svg>
	{:else if icon === 'sessions'}
		<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-cp-text-muted mb-3">
			<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
			<line x1="8" y1="21" x2="16" y2="21"/>
			<line x1="12" y1="17" x2="12" y2="21"/>
		</svg>
	{/if}

	<h3 class="text-[var(--cp-text-sm)] font-medium text-cp-text-secondary">{title}</h3>
	{#if description}
		<p class="text-[var(--cp-text-xs)] text-cp-text-muted mt-1 max-w-xs">{description}</p>
	{/if}
</div>
