<script lang="ts">
	let { title, children }: { title: string; children: any } = $props();
</script>

<article class="card">
	<p class="card-title">{title}</p>
	<div class="card-body">
		{@render children()}
	</div>
</article>

<style>
	.card {
		border: 1px solid var(--color-gray-300);
		padding: 1.25rem;
	}

	:global([data-theme='dark']) .card {
		border-color: var(--color-gray-700);
	}

	.card-title {
		font-weight: 600;
		margin-bottom: 0.375rem;
	}

	.card-body {
		font-size: 0.875rem;
		color: var(--color-gray-600);
	}

	:global([data-theme='dark']) .card-body {
		color: var(--color-gray-400);
	}

	.card-body :global(p) {
		margin: 0;
	}
</style>
