// SPA mode — no SSR, no prerender
export const ssr = false;
export const prerender = false;

import { discoverConvexUrl, GITHUB_URL } from "$lib/stores/auth.svelte";
import type { DiscoveryResult } from "$lib/stores/auth.svelte";

/**
 * Discover the Convex cloud URL before the layout mounts.
 *
 * - Self-hosted: fetches /.well-known/portal-config from same origin.
 * - CDN with ?d=: derives URL from the deployment slug.
 * - CDN without ?d=: redirects to the GitHub repo.
 */
export async function load(): Promise<{ discovery: DiscoveryResult | null }> {
	const discovery = await discoverConvexUrl();

	if (!discovery && typeof window !== "undefined") {
		window.location.replace(GITHUB_URL);
	}

	return { discovery };
}
