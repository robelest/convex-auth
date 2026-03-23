<script lang="ts">
	import SearchDialog from './SearchDialog.svelte';

	let { onMenuToggle }: { onMenuToggle?: () => void } = $props();
	let searchOpen = $state(false);

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			searchOpen = !searchOpen;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="header">
	<div class="header-inner">
		<div class="left">
			{#if onMenuToggle}
				<button class="menu-btn" onclick={onMenuToggle} aria-label="Toggle menu">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M3 4h18v2H3V4Zm0 7h18v2H3v-2Zm0 7h18v2H3v-2Z" />
					</svg>
				</button>
			{/if}
			<button class="search-btn" onclick={() => (searchOpen = true)} aria-label="Search">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
					<path d="M21.71 20.29 18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a.999.999 0 0 0 1.42 0 1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
				</svg>
				<span class="search-label">Search</span>
				<kbd><kbd>⌘</kbd><kbd>K</kbd></kbd>
			</button>
		</div>

		<div class="right">
			<a href="https://github.com/robelest/convex-auth" class="icon-link" aria-label="GitHub">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.08 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3Z" />
				</svg>
			</a>
		</div>
	</div>
</header>

<SearchDialog bind:open={searchOpen} />

<style>
	.header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		height: 3.5rem;
		background-color: var(--color-gray-50);
		border-bottom: 1px solid var(--color-gray-300);
	}

	:global([data-theme='dark']) .header {
		background-color: var(--color-gray-950);
		border-bottom-color: var(--color-gray-800);
	}

	.header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 100%;
		padding: 0 1rem;
	}

	.left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.menu-btn {
		display: none;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		color: var(--color-gray-600);
	}

	@media (max-width: 767px) {
		.menu-btn {
			display: flex;
		}
	}

	.search-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-gray-300);
		background-color: var(--color-gray-50);
		color: var(--color-gray-500);
		font-size: 0.8125rem;
		cursor: pointer;
		min-width: 12rem;
	}

	:global([data-theme='dark']) .search-btn {
		border-color: var(--color-gray-700);
		background-color: var(--color-gray-950);
		color: var(--color-gray-400);
	}

	.search-btn:hover {
		border-color: var(--color-gray-500);
	}

	.search-label {
		flex: 1;
		text-align: left;
	}

	kbd {
		font-family: var(--font-sans);
		font-size: 0.6875rem;
		padding: 0.125rem 0.25rem;
		background: var(--color-gray-200);
		color: var(--color-gray-600);
	}

	:global([data-theme='dark']) kbd {
		background: var(--color-gray-800);
		color: var(--color-gray-400);
	}

	.icon-link {
		display: flex;
		color: var(--color-gray-600);
		text-decoration: none;
	}

	:global([data-theme='dark']) .icon-link {
		color: var(--color-gray-400);
	}

	.icon-link:hover {
		color: var(--color-gray-900);
	}

	:global([data-theme='dark']) .icon-link:hover {
		color: #ede8e0;
	}
</style>
