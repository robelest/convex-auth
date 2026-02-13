<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';

	onMount(() => {
		goto(`${base}/users`, { replaceState: true });
	});
</script>

<div class="flex items-center justify-center h-full">
	<div class="cp-skeleton w-32 h-4"></div>
</div>
