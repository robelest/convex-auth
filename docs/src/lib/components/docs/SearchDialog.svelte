<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { slide, fade } from 'svelte/transition';
	import { sidebar } from '$lib/config/sidebar';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let query = $state('');
	let results = $state<Array<{ url: string; title: string; excerpt: string; section: string }>>([]);
	let activeIndex = $state(0);
	let pagefind: any = $state(null);
	let inputEl: HTMLInputElement | undefined = $state();

	// Build a url → section label map from sidebar config
	const sectionMap = new Map<string, string>();
	for (const group of sidebar) {
		for (const item of group.items) {
			sectionMap.set(item.slug, group.label);
			sectionMap.set(item.slug + '/', group.label);
		}
	}

	function getSectionLabel(url: string): string {
		const clean = url.replace(/\/+$/, '');
		return sectionMap.get(clean) ?? '';
	}

	onMount(async () => {
		try {
			const resp = await fetch('/pagefind/pagefind.js');
			if (!resp.ok) return;
			pagefind = await new Function('return import("/pagefind/pagefind.js")')();
			await pagefind.init();
		} catch (e) {
			console.warn('Pagefind not available:', e);
		}
	});

	async function search(q: string) {
		if (!pagefind || !q.trim()) {
			results = [];
			activeIndex = 0;
			return;
		}

		const response = await pagefind.search(q);
		const items = await Promise.all(
			response.results.slice(0, 6).map(async (r: any) => {
				const data = await r.data();
				return {
					url: data.url,
					title: data.meta?.title || data.url,
					excerpt: data.excerpt,
					section: getSectionLabel(data.url)
				};
			})
		);
		results = items;
		activeIndex = 0;
	}

	// Clear state when closing so next open starts fresh (no flicker)
	$effect(() => {
		if (!open) {
			query = '';
			results = [];
			activeIndex = 0;
		}
	});

	// Focus input when opening
	$effect(() => {
		if (open && inputEl) {
			requestAnimationFrame(() => inputEl?.focus());
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = Math.min(activeIndex + 1, results.length - 1);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			return;
		}
		if (e.key === 'Enter' && results.length > 0) {
			e.preventDefault();
			selectResult(results[activeIndex].url);
		}
	}

	function selectResult(url: string) {
		open = false;
		goto(url);
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="backdrop" transition:fade={{ duration: 100 }} onclick={() => (open = false)}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="panel"
			transition:slide={{ duration: 150 }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKeydown}
		>
			<div class="panel-inner">
				<div class="input-row">
					<svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<path d="M21.71 20.29 18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a.999.999 0 0 0 1.42 0 1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
					</svg>
					<input
						bind:this={inputEl}
						bind:value={query}
						oninput={() => search(query)}
						onkeydown={handleKeydown}
						placeholder="Search documentation..."
						type="text"
						spellcheck="false"
					/>
					<kbd class="esc-hint">ESC</kbd>
				</div>

				{#if results.length > 0}
					<ul class="results">
						{#each results as result, i}
							<li>
								<button
									class="result-row"
									class:active={i === activeIndex}
									onclick={() => selectResult(result.url)}
									onmouseenter={() => (activeIndex = i)}
								>
									{#if result.section}
										<span class="result-section">{result.section}</span>
									{/if}
									<span class="result-title">{result.title}</span>
									<span class="result-excerpt">{@html result.excerpt}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if query && pagefind}
					<p class="no-results">No results for "{query}"</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		background-color: rgba(21, 19, 16, 0.3);
		display: flex;
		justify-content: center;
		padding-top: 3.5rem;
	}

	.panel {
		background-color: var(--color-gray-50);
		border: 1px solid var(--color-gray-300);
		width: 90%;
		max-width: 36rem;
		max-height: calc(100vh - 7rem);
		height: fit-content;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	:global([data-theme='dark']) .panel {
		background-color: var(--color-gray-950);
		border-color: var(--color-gray-800);
	}

	.panel-inner {
		padding: 0 1rem;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.875rem 0;
	}

	.search-icon {
		flex-shrink: 0;
		color: var(--color-gray-400);
	}

	input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font-family: var(--font-sans);
		font-size: 1.125rem;
		color: var(--color-gray-900);
	}

	:global([data-theme='dark']) input {
		color: #ede8e0;
	}

	input::placeholder {
		color: var(--color-gray-400);
	}

	.esc-hint {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		letter-spacing: 0.05em;
		color: var(--color-gray-400);
		padding: 0.125rem 0.375rem;
		border: 1px solid var(--color-gray-300);
	}

	:global([data-theme='dark']) .esc-hint {
		border-color: var(--color-gray-700);
	}

	.results {
		list-style: none;
		padding: 0;
		margin: 0;
		border-top: 1px solid var(--color-gray-200);
		padding-bottom: 0.5rem;
	}

	:global([data-theme='dark']) .results {
		border-top-color: var(--color-gray-800);
	}

	.result-row {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.5rem 0.5rem 0.75rem;
		border: none;
		border-left: 2px solid transparent;
		background: transparent;
		cursor: pointer;
		font-family: var(--font-sans);
		transition: border-color 0.1s ease;
	}

	.result-row.active {
		border-left-color: var(--color-accent-500);
	}

	:global([data-theme='dark']) .result-row.active {
		border-left-color: var(--color-accent-400);
	}

	.result-section {
		display: block;
		font-family: var(--font-mono);
		font-size: 0.5625rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-gray-400);
		margin-bottom: 0.125rem;
	}

	.result-title {
		display: block;
		font-size: 0.875rem;
		color: var(--color-gray-900);
	}

	:global([data-theme='dark']) .result-title {
		color: #ede8e0;
	}

	.result-row.active .result-title {
		color: var(--color-accent-500);
	}

	:global([data-theme='dark']) .result-row.active .result-title {
		color: var(--color-accent-400);
	}

	.result-excerpt {
		display: block;
		font-size: 0.6875rem;
		color: var(--color-gray-500);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-top: 0.0625rem;
	}

	.result-excerpt :global(mark) {
		background: none;
		color: var(--color-accent-600);
		font-weight: 500;
	}

	:global([data-theme='dark']) .result-excerpt :global(mark) {
		color: var(--color-accent-300);
	}

	.no-results {
		padding: 1rem 0;
		font-size: 0.75rem;
		color: var(--color-gray-400);
		border-top: 1px solid var(--color-gray-200);
	}

	:global([data-theme='dark']) .no-results {
		border-top-color: var(--color-gray-800);
	}
</style>
