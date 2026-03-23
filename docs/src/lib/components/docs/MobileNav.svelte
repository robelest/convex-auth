<script lang="ts">
	import { page } from '$app/state';
	import { sidebar } from '$lib/config/sidebar';
	import { fade, fly } from 'svelte/transition';

	let { open = $bindable(false) }: { open: boolean } = $props();

	function isActive(slug: string): boolean {
		return page.url.pathname.replace(/\/$/, '') === slug;
	}

	function navigate() {
		open = false;
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay" transition:fade={{ duration: 100 }} onclick={() => (open = false)}>
		<nav
			class="sheet"
			transition:fly={{ x: -300, duration: 200 }}
			onclick={(e) => e.stopPropagation()}
		>
			<div class="sheet-header">
				<button class="close-btn" onclick={() => (open = false)} aria-label="Close menu">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="m13.41 12 6.3-6.29a1 1 0 1 0-1.42-1.42L12 10.59l-6.29-6.3a1 1 0 0 0-1.42 1.42l6.3 6.29-6.3 6.29a1 1 0 0 0 1.42 1.42l6.29-6.3 6.29 6.3a1 1 0 0 0 1.42-1.42L13.41 12Z" />
					</svg>
				</button>
			</div>

			<div class="sheet-content">
				{#each sidebar as group}
					<div class="group">
						<p class="group-label">{group.label}</p>
						<ul>
							{#each group.items as item}
								<li>
									<a
										href="{item.slug}/"
										class:active={isActive(item.slug)}
										onclick={navigate}
									>
										{item.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</nav>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 40;
		background-color: rgba(21, 19, 16, 0.4);
	}

	.sheet {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 100%;
		max-width: 20rem;
		background-color: var(--color-gray-50);
		overflow-y: auto;
		scrollbar-width: none;
	}

	:global([data-theme='dark']) .sheet {
		background-color: var(--color-gray-950);
	}

	.sheet::-webkit-scrollbar {
		display: none;
	}

	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		height: 3.5rem;
		padding: 0 1rem;
		border-bottom: 1px solid var(--color-gray-300);
	}

	:global([data-theme='dark']) .sheet-header {
		border-bottom-color: var(--color-gray-800);
	}

	.close-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-gray-500);
		padding: 0.25rem;
		display: flex;
	}

	.sheet-content {
		padding: 1rem 0;
	}

	.group {
		margin-bottom: 0.5rem;
	}

	.group-label {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-gray-500);
		padding: 0.375rem 1.25rem;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li a {
		display: block;
		padding: 0.5rem 1.25rem;
		font-size: 0.9375rem;
		color: var(--color-gray-700);
		text-decoration: none;
	}

	:global([data-theme='dark']) li a {
		color: var(--color-gray-400);
	}

	li a.active {
		color: var(--color-accent-500);
		border-left: 2px solid var(--color-accent-500);
		padding-left: calc(1.25rem - 2px);
	}

	:global([data-theme='dark']) li a.active {
		color: var(--color-accent-400);
		border-left-color: var(--color-accent-400);
	}
</style>
