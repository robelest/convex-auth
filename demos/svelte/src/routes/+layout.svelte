<script lang="ts">
	import "./layout.css";
	import favicon from "$lib/assets/favicon.svg";
	import { page } from "$app/state";
	import { onNavigate } from "$app/navigation";
	import { Toaster } from "svelte-sonner";
	import { setupConvex, useQuery } from "convex-svelte";
	import { onMount, setContext } from "svelte";
	import { client as createAuthClient } from "@robelest/convex-auth/browser";
	import { api } from "$convex/_generated/api.js";

	let { children } = $props();

	const onConvexSite =
		typeof window !== "undefined" && window.location.hostname.endsWith(".convex.site");
	const convexUrl = onConvexSite
		? `https://${window.location.hostname.replace(".convex.site", ".convex.cloud")}`
		: (import.meta.env.VITE_CONVEX_URL as string);
	const siteUrl = onConvexSite
		? window.location.origin
		: convexUrl.replace(".convex.cloud", ".convex.site");

	const convexClient = setupConvex(convexUrl);

	const auth = createAuthClient({
		convex: convexClient,
		api: api.auth,
		location: () => page.url,
	});

	setContext("auth", auth);

	let authState = $state(auth.state);
	onMount(() => {
		void auth.initialize();
		return auth.onChange(() => {
			authState = auth.state;
		});
	});

	const authProvidersQuery = useQuery(api.groups.authProviders, () => ({}));

	setContext("app", {
		get isAuthenticated() {
			return authState.isAuthenticated;
		},
		get isLoading() {
			return authState.isLoading;
		},
		get authProviders() {
			return authProvidersQuery.data ?? { google: false };
		},
		siteUrl,
	});

	onNavigate((navigation) => {
		const doc = document as Document & {
			startViewTransition?: (callback: () => Promise<void> | void) => void;
		};
		if (!doc.startViewTransition) return;
		return new Promise((resolve) => {
			doc.startViewTransition!(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>convex-auth demo</title>
</svelte:head>

{#if authState.isAuthenticated}
	<div class="grid min-h-dvh grid-cols-[12rem_minmax(0,1fr)] bg-background-primary max-md:grid-cols-1 max-md:grid-rows-[auto_1fr]" data-theme="dark">
		{@render children()}
	</div>
{:else}
	<div class="min-h-dvh bg-background-primary" data-theme="dark">
		<div class="fixed inset-0 grid place-items-center bg-black/50 p-6 px-4">
			{@render children()}
		</div>
	</div>
{/if}

<Toaster theme="dark" richColors closeButton position="top-right" />
