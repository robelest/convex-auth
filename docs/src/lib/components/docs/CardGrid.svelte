<script lang="ts">
	let { children }: { children: any } = $props();
</script>

<div class="card-grid">
	{@render children()}
</div>

<style>
	.card-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	@media (min-width: 640px) {
		.card-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
