<script lang="ts">
	import { page } from '$app/state';

	const message = $derived(
		page.status === 404
			? 'This page has wandered off.'
			: page.error?.message || 'Something went wrong.'
	);
</script>

<svelte:head>
	<title>{page.status} — convex-auth</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="error-page">
	<p class="message">
		{message}
		<a href="/">Return to docs.</a>
	</p>
</main>

<style>
	.error-page {
		position: fixed;
		inset: 0;
		top: 3.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background-color: var(--color-gray-50);
		z-index: 10;
	}

	:global([data-theme='dark']) .error-page {
		background-color: var(--color-gray-950);
	}

	.message {
		font-size: 1.125rem;
		color: var(--color-gray-900);
		text-align: center;
	}

	:global([data-theme='dark']) .message {
		color: #ede8e0;
	}

	.message a {
		color: var(--color-accent-500);
		text-decoration: none;
		text-underline-offset: 0.15em;
		transition: text-decoration 0.15s ease;
	}

	.message a:hover {
		text-decoration: underline;
	}
</style>
