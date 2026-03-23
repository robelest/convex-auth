<script lang="ts">
	import { page } from '$app/state';
	import { sidebar } from '$lib/config/sidebar';
	import { slide } from 'svelte/transition';

	let openGroups = $state<Record<string, boolean>>({});

	// Auto-open the group containing the current page
	$effect(() => {
		for (const group of sidebar) {
			if (group.items.some((item) => page.url.pathname.replace(/\/$/, '') === item.slug)) {
				openGroups[group.label] = true;
			}
		}
	});

	function toggleGroup(label: string) {
		openGroups[label] = !openGroups[label];
	}

	function isActive(slug: string): boolean {
		return page.url.pathname.replace(/\/$/, '') === slug;
	}
</script>

<aside class="sidebar">
	<nav>
		{#each sidebar as group}
			<div class="group">
				<button class="group-label" onclick={() => toggleGroup(group.label)}>
					<span>{group.label}</span>
					<svg
						class="chevron"
						class:open={openGroups[group.label]}
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path d="M17 9.17a1 1 0 0 0-1.41 0L12 12.71 8.46 9.17a1 1 0 1 0-1.41 1.42l4.24 4.24a1.002 1.002 0 0 0 1.42 0L17 10.59a1.002 1.002 0 0 0 0-1.42Z" />
					</svg>
				</button>

				{#if openGroups[group.label]}
					<ul transition:slide={{ duration: 150 }}>
						{#each group.items as item}
							<li>
								<a
									href="{item.slug}/"
									class:active={isActive(item.slug)}
								>
									{item.title}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</nav>
</aside>

<style>
	.sidebar {
		width: 100%;
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
		padding: 1rem 0;
	}

	.sidebar::-webkit-scrollbar {
		display: none;
	}

	.group {
		margin-bottom: 0.25rem;
	}

	.group-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.375rem 1rem;
		font-family: var(--font-label);
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-gray-900);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	[data-theme='dark'] .group-label {
		color: #d4cec4;
	}

	.chevron {
		transition: transform 0.15s ease;
		opacity: 0.5;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li a {
		display: block;
		padding: 0.25rem 1rem 0.25rem 1.25rem;
		font-size: 0.8125rem;
		color: var(--color-gray-600);
		text-decoration: none;
		transition: color 0.15s ease;
	}

	[data-theme='dark'] li a {
		color: var(--color-gray-400);
	}

	li a:hover {
		color: var(--color-gray-900);
	}

	[data-theme='dark'] li a:hover {
		color: #ede8e0;
	}

	li a.active {
		color: var(--color-accent-500);
		border-left: 2px solid var(--color-accent-500);
		padding-left: calc(1.25rem - 2px);
	}

	[data-theme='dark'] li a.active {
		color: var(--color-accent-400);
		border-left-color: var(--color-accent-400);
	}
</style>
