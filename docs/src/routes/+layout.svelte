<script lang="ts">
	import { page } from '$app/state';
	import '../app.css';
	import Header from '$lib/components/docs/Header.svelte';
	import Sidebar from '$lib/components/docs/Sidebar.svelte';
	import MobileNav from '$lib/components/docs/MobileNav.svelte';
	import { tableOverflow } from '$lib/utils/tableOverflow';

	let { children } = $props();
	let mobileNavOpen = $state(false);

	const isLanding = $derived(page.url.pathname === '/');
</script>

<svelte:head>
	<title>convex-auth</title>
</svelte:head>

<Header onMenuToggle={() => (mobileNavOpen = !mobileNavOpen)} />
<MobileNav bind:open={mobileNavOpen} />

{#if isLanding}
	<main class="landing" data-pagefind-body>
		{#key page.url.pathname}
			{@render children()}
		{/key}
	</main>
{:else}
	<div class="docs-layout">
		<div class="sidebar-container">
			<Sidebar />
		</div>
		<main class="docs-main">
			<div class="doc-content" data-pagefind-body {@attach tableOverflow}>
				{#key page.url.pathname}
					{@render children()}
				{/key}
			</div>
		</main>
	</div>
{/if}

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		width: 100%;
		overflow-x: hidden;
	}

	:global(body) {
		padding-top: 3.5rem;
	}

	.docs-layout {
		min-height: calc(100dvh - 3.5rem);
	}

	.sidebar-container {
		display: none;
	}

	.docs-main {
		max-width: 100ch;
		width: 100%;
		min-width: 0;
		margin: 0 auto;
		padding: 1rem 1rem 3rem;
	}

	@media (min-width: 768px) {
		.sidebar-container {
			display: block;
			position: fixed;
			top: 3.5rem;
			bottom: 0;
			left: 0;
			width: 15rem;
			border-right: 1px solid var(--color-gray-300);
			z-index: 10;
		}

		:global([data-theme='dark']) .sidebar-container {
			border-right-color: var(--color-gray-800);
		}

		.docs-main {
			margin-left: 15rem;
			padding: 1rem 1.5rem 3rem;
		}
	}

	.landing {
		max-width: 70ch;
		margin: 0 auto;
		padding: 4rem 1rem;
	}

	@media (min-width: 768px) {
		.landing {
			padding: 6rem 1.5rem;
		}
	}
</style>
