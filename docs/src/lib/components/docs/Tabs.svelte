<script lang="ts">
	import { setContext } from 'svelte';

	let { syncKey, children }: { syncKey?: string; children: any } = $props();
	let activeTab = $state(0);

	const tabs: string[] = $state([]);

	function registerTab(label: string): number {
		const idx = tabs.length;
		tabs.push(label);
		return idx;
	}

	setContext('tabs', {
		get activeTab() { return activeTab; },
		registerTab,
		setActive: (idx: number) => { activeTab = idx; }
	});
</script>

<div class="tabs">
	<div class="tab-bar" role="tablist">
		{#each tabs as label, i}
			<button
				role="tab"
				aria-selected={activeTab === i}
				class:active={activeTab === i}
				onclick={() => { activeTab = i; }}
			>
				{label}
			</button>
		{/each}
	</div>
	<div class="tab-content">
		{@render children()}
	</div>
</div>

<style>
	.tabs {
		margin-bottom: 1rem;
	}

	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--color-gray-300);
		margin-bottom: 1rem;
	}

	:global([data-theme='dark']) .tab-bar {
		border-bottom-color: var(--color-gray-700);
	}

	button {
		padding: 0.375rem 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-gray-500);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		margin-bottom: -1px;
		transition: color 0.15s ease, border-color 0.15s ease;
	}

	button:hover {
		color: var(--color-gray-900);
	}

	:global([data-theme='dark']) button:hover {
		color: #ede8e0;
	}

	button.active {
		color: var(--color-accent-500);
		border-bottom-color: var(--color-accent-500);
	}

	:global([data-theme='dark']) button.active {
		color: var(--color-accent-400);
		border-bottom-color: var(--color-accent-400);
	}
</style>
