<script lang="ts">
	/** Full-screen spinner with a message. */
	interface Props { message: string }
	let { message }: Props = $props();
</script>

<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
	<div class="text-center">
		<div class="w-8 h-8 border-2 border-cp-accent/30 border-t-cp-accent rounded-full animate-spin mx-auto mb-4"></div>
		<p class="text-[var(--cp-text-sm)] text-cp-text-muted">{message}</p>
	</div>
</div>
