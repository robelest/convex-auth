<script>
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import ArrowSquareOut from 'phosphor-svelte/lib/ArrowSquareOut';
</script>

<svelte:head>
	<title>convex-auth — Component-first authentication for Convex</title>
	<meta name="description" content="One component, one setup API, full TypeScript support." />
</svelte:head>

<h1 class="hero-title">convex-auth</h1>
<p class="hero-tagline"><em>One component, one setup API, full TypeScript support.</em></p>

<div class="hero-actions">
	<a href="/getting-started/installation/" class="btn-primary">
		Get Started <CaretRight size={16} weight="bold" />
	</a>
	<a href="https://github.com/robelest/convex-auth" class="btn-minimal">
		GitHub <ArrowSquareOut size={14} />
	</a>
</div>

<style>
	.hero-title {
		font-family: var(--font-sans);
		font-size: 3rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.2;
		margin-bottom: 0.5rem;
	}

	.hero-tagline {
		font-size: 1.125rem;
		color: var(--color-gray-600);
		margin-bottom: 2rem;
	}

	:global([data-theme='dark']) .hero-tagline {
		color: var(--color-gray-400);
	}

	.hero-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 4rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1.25rem;
		background-color: var(--color-accent-500);
		color: var(--color-gray-50);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		border: 1px solid var(--color-accent-500);
		transition: background-color 0.15s ease;
	}

	.btn-primary:hover {
		background-color: var(--color-accent-600);
		color: var(--color-gray-50);
	}

	.btn-minimal {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		color: var(--color-gray-600);
		text-decoration: none;
		font-size: 0.875rem;
	}

	:global([data-theme='dark']) .btn-minimal {
		color: var(--color-gray-400);
	}

	.btn-minimal:hover {
		color: var(--color-gray-900);
	}

</style>
