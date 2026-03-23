<script lang="ts">
	import { getContext, onMount } from 'svelte';

	let { label, children }: { label: string; children: any } = $props();

	const ctx = getContext<{
		activeTab: number;
		registerTab: (label: string) => number;
		setActive: (idx: number) => void;
	}>('tabs');

	let idx = $state(-1);

	onMount(() => {
		idx = ctx.registerTab(label);
	});
</script>

{#if idx >= 0 && ctx.activeTab === idx}
	<div role="tabpanel">
		{@render children()}
	</div>
{/if}
