<script lang="ts">
	import "./layout.css";
	import favicon from "$lib/assets/favicon.svg";
	import { page } from "$app/state";
	import { setupConvex, useConvexClient } from "convex-svelte";
	import { setContext, untrack } from "svelte";
	import { client as createAuthClient } from "@robelest/convex-auth/browser";

	let { data, children } = $props();
	const convexUrl = untrack(() => data.convexUrl!);
	const tokenSeed = untrack(() => data.auth.token ?? null);

	setupConvex(convexUrl);

	const convexClient = useConvexClient();

	const auth = createAuthClient({
		convex: convexClient,
		proxyPath: "/api/auth",
		tokenSeed,
		location: () => page.url,
	});

	setContext("auth", auth);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>convex-auth demo</title>
</svelte:head>

{#if data.auth.isAuthenticated}
	<div class="grid min-h-dvh grid-cols-[12rem_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_1fr]" data-theme="light">
		{@render children()}
	</div>
{:else}
	<div class="grid min-h-dvh place-items-center p-6 px-4" data-theme="light">
		{@render children()}
	</div>
{/if}
