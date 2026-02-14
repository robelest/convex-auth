<script lang="ts">
	import { goto } from '$app/navigation';
	import { portalHref } from '$lib/stores/auth.svelte';
	import { onMount } from 'svelte';

	onMount(() => {
		goto(portalHref('/users'), { replaceState: true });
	});
</script>

<div class="flex items-center justify-center h-full">
	<div class="cp-skeleton w-32 h-4"></div>
</div>
