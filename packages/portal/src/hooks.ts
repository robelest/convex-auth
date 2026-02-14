import { base } from "$app/paths";
import type { Reroute } from "@sveltejs/kit";

/**
 * In CDN mode (base === ""), the first path segment is the deployment slug
 * (e.g. /rapid-cat-62/users). Strip it so SvelteKit matches the flat
 * route structure (/users/+page.svelte). The address bar keeps the full path.
 *
 * Self-hosted mode (base === "/auth") doesn't need rerouting — SvelteKit
 * already strips the base path automatically.
 *
 * Dev mode (base === ""): also applies but slug presence is optional
 * (localhost uses VITE_CONVEX_URL directly).
 */
export const reroute: Reroute = ({ url }) => {
	if (base !== "") return; // self-hosted — no rerouting needed

	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length === 0) return; // bare root — no slug

	// First segment is the deployment slug. Remove it and return the rest.
	return "/" + segments.slice(1).join("/");
};
