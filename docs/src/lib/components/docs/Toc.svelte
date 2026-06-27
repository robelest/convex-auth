<script lang="ts">
	import { onMount } from 'svelte';

	interface Heading {
		id: string;
		text: string;
		level: number;
	}

	let headings = $state<Heading[]>([]);
	let activeId = $state('');

	onMount(() => {
		const content = document.querySelector('.doc-content');
		if (!content) return;

		const els = content.querySelectorAll('h2, h3');
		headings = Array.from(els).map((el) => ({
			id: el.id,
			text: el.textContent ?? '',
			level: parseInt(el.tagName[1]),
		}));

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						activeId = entry.target.id;
					}
				}
			},
			{ rootMargin: '-80px 0px -70% 0px' },
		);

		for (const el of els) observer.observe(el);

		return () => observer.disconnect();
	});
</script>

{#if headings.length > 0}
	<aside class="toc">
		<nav>
			<p class="toc-label">On this page</p>
			<ul>
				{#each headings as heading (heading.id)}
					<li class:nested={heading.level === 3}>
						<a href="#{heading.id}" class:active={activeId === heading.id}>
							{heading.text}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	</aside>
{/if}

<style>
	.toc {
		width: 11rem;
		flex-shrink: 0;
		position: sticky;
		top: 3.5rem;
		height: calc(100vh - 3.5rem);
		overflow-y: auto;
		scrollbar-width: none;
		padding: 1rem 0;
	}

	.toc::-webkit-scrollbar {
		display: none;
	}

	.toc-label {
		font-family: var(--font-label);
		font-size: 0.625rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-gray-500);
		padding: 0 0.75rem;
		margin-bottom: 0.5rem;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li a {
		display: block;
		padding: 0.1875rem 0.75rem;
		font-size: 0.75rem;
		color: var(--color-gray-500);
		text-decoration: none;
		line-height: 1.4;
		transition: color 0.15s ease;
	}

	li.nested a {
		padding-left: 1.25rem;
	}

	li a:hover {
		color: var(--color-gray-900);
	}

	:global([data-theme='dark'] li a:hover) {
		color: #ede8e0;
	}

	li a.active {
		color: var(--color-accent-500);
	}

	:global([data-theme='dark'] li a.active) {
		color: var(--color-accent-400);
	}
</style>
