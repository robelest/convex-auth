/**
 * Portal auth store — Svelte 5 reactive state wrapping the convex-auth client.
 *
 * Single reactive object (`auth`) is the source of truth for all auth state.
 * All side-effects (magic link, invite acceptance, sign-out) are exported
 * functions that mutate `auth` properties.
 *
 * The layout reads `auth.*` and derives a single `screen` discriminant —
 * no boolean flag soup.
 */
import { client as createAuthClient, type AuthState } from "@robelest/convex-auth/client";
import type { ConvexClient } from "convex/browser";
import { base } from "$app/paths";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVITE_STORAGE_KEY = "__portalInviteToken";
const GITHUB_URL = "https://github.com/robelest/convex-auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowState = "idle" | "sending" | "sent" | "error";
type InviteState = "none" | "pending" | "accepting" | "accepted" | "error";

export interface PortalConfig {
	convexUrl: string;
	siteUrl: string;
	version: string;
}

export interface DiscoveryResult {
	url: string;
	config: PortalConfig | null;
	slug?: string;
}

// ---------------------------------------------------------------------------
// Reactive store (single source of truth)
// ---------------------------------------------------------------------------

export const auth = $state({
	initialized: false,
	state: { isLoading: true, isAuthenticated: false, token: null } as AuthState,

	/** Magic-link login flow */
	flowState: "idle" as FlowState,
	errorMessage: null as string | null,

	/** Invite token from URL / sessionStorage */
	inviteToken: null as string | null,
	inviteState: "none" as InviteState,
	inviteError: null as string | null,

	/** Server config from /.well-known/portal-config (null in CDN/dev mode) */
	serverConfig: null as PortalConfig | null,

	/** Deployment slug from URL path (CDN mode only, e.g. "rapid-cat-62") */
	slug: null as string | null,
});

// ---------------------------------------------------------------------------
// Auth client ref (set once during init)
// ---------------------------------------------------------------------------

let _client: ReturnType<typeof createAuthClient> | null = null;
let _convex: ConvexClient | null = null;

// ---------------------------------------------------------------------------
// Convex URL Discovery (async)
// ---------------------------------------------------------------------------

/**
 * Discover the Convex cloud URL. Called once before the layout mounts.
 *
 * **Self-hosted** (`base = '/auth'`): fetches `{origin}/auth/.well-known/portal-config`
 * from the Convex HTTP action layer. Works for *.convex.site and custom domains.
 *
 * **CDN** (`base = ''`): reads `?d=` query param → `https://{slug}.convex.cloud`.
 * No `?d=`? Returns `null` — caller should redirect to GitHub.
 *
 * **Dev** (localhost): uses `VITE_CONVEX_URL` (portal dev server is always Vite).
 *
 * @returns Discovery result with URL + optional config, or `null` to trigger redirect.
 */
export async function discoverConvexUrl(): Promise<DiscoveryResult | null> {
	if (typeof window === "undefined") {
		// SSR safety (shouldn't happen — ssr: false)
		return { url: import.meta.env.VITE_CONVEX_URL ?? "http://localhost:3210", config: null };
	}

	const hostname = window.location.hostname;

	// Dev mode — localhost always uses the Vite env var
	if (hostname === "localhost" || hostname === "127.0.0.1") {
		return { url: import.meta.env.VITE_CONVEX_URL ?? "http://localhost:3210", config: null };
	}

	// Self-hosted build: portal lives at {origin}/auth/
	// Fetch the config endpoint from the same Convex HTTP action origin.
	if (base === "/auth") {
		try {
			const resp = await fetch(`${window.location.origin}/auth/.well-known/portal-config`);
			if (resp.ok) {
				const config: PortalConfig = await resp.json();
				return { url: config.convexUrl, config };
			}
		} catch {
			// Config endpoint unavailable — fall back to hostname derivation
		}

		// Fallback for older deployments without the config endpoint:
		// derive cloud URL from *.convex.site hostname
		if (hostname.endsWith(".convex.site")) {
			return { url: `https://${hostname.replace(".convex.site", ".convex.cloud")}`, config: null };
		}

		// Custom domain without config endpoint — can't determine cloud URL
		return null;
	}

	// CDN build: portal lives at root of auth.robelest.com (or similar)
	// First path segment is the deployment slug (e.g. /rapid-cat-62/users).
	const segments = window.location.pathname.split("/").filter(Boolean);
	const slug = segments[0] ?? null;
	if (slug) {
		return { url: `https://${slug}.convex.cloud`, config: null, slug };
	}

	// CDN without ?d= → signal caller to redirect to GitHub
	return null;
}

/** The GitHub URL for redirect when CDN is visited without ?d= */
export { GITHUB_URL };

// ---------------------------------------------------------------------------
// Invite token extraction (pure, called once during init)
// ---------------------------------------------------------------------------

function extractInviteToken(): string | null {
	if (typeof window === "undefined") return null;

	const url = new URL(window.location.href);
	const invite = url.searchParams.get("invite");

	if (invite) {
		sessionStorage.setItem(INVITE_STORAGE_KEY, invite);
		// Clean the invite param from URL without triggering navigation
		url.searchParams.delete("invite");
		window.history.replaceState({}, "", url.pathname + url.search + url.hash);
		return invite;
	}

	// Restore from sessionStorage (after magic link redirect round-trip)
	return sessionStorage.getItem(INVITE_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the auth client. Call once from the root layout after
 * `setupConvex()` has been called and a `ConvexClient` is available.
 */
export function initAuth(convex: ConvexClient): void {
	if (auth.initialized) return;

	_convex = convex;
	auth.inviteToken = extractInviteToken();
	auth.inviteState = auth.inviteToken ? "pending" : "none";

	_client = createAuthClient({ convex });
	_client.onChange((state) => { auth.state = state; });

	auth.initialized = true;
}

// ---------------------------------------------------------------------------
// Actions — Magic Link
// ---------------------------------------------------------------------------

/**
 * Build the redirect URL for magic link, preserving `?d=` for CDN mode.
 */
function getPortalRedirectUrl(): string {
	if (typeof window === "undefined") return "";
	return auth.slug
		? `${window.location.origin}/${auth.slug}`
		: `${window.location.origin}${base}`;
}

/**
 * Build a slug-aware internal href. In CDN mode, prepends `/${slug}`.
 * In self-hosted mode, prepends `${base}`.
 *
 * @param path — route path starting with `/`, e.g. `/users` or `/users/${id}`
 */
export function portalHref(path: string): string {
	return auth.slug ? `/${auth.slug}${path}` : `${base}${path}`;
}

/**
 * Send a magic link email for portal sign-in.
 */
export async function sendMagicLink(
	email: string,
	provider = "portal",
): Promise<void> {
	if (!_client) throw new Error("Auth not initialized");

	auth.flowState = "sending";
	auth.errorMessage = null;

	try {
		await _client.signIn(provider, { email, redirectTo: getPortalRedirectUrl() });
		auth.flowState = "sent";
	} catch (e: unknown) {
		auth.flowState = "error";
		auth.errorMessage = e instanceof Error ? e.message : "Failed to send magic link";
	}
}

/** Reset the login form flow state. */
export function resetFlow(): void {
	auth.flowState = "idle";
	auth.errorMessage = null;
}

// ---------------------------------------------------------------------------
// Actions — Invite Acceptance
// ---------------------------------------------------------------------------

/**
 * Hash a token string with SHA-256 (matches what the CLI stores).
 */
async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Accept a portal invite. Called by the layout when the user is authenticated
 * and has an invite token but isn't yet an admin.
 *
 * @param portalMutationRef — the `api.auth.portalMutation` reference
 */
export async function acceptInvite(
	portalMutationRef: unknown,
): Promise<void> {
	if (!_convex || !auth.inviteToken) return;
	if (auth.inviteState === "accepting" || auth.inviteState === "accepted") return;

	auth.inviteState = "accepting";
	auth.inviteError = null;

	try {
		const tokenHash = await hashToken(auth.inviteToken);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await _convex.mutation(portalMutationRef as any, {
			action: "acceptInvite",
			tokenHash,
		});
		auth.inviteState = "accepted";
		sessionStorage.removeItem(INVITE_STORAGE_KEY);
		auth.inviteToken = null;
	} catch (e: unknown) {
		auth.inviteState = "error";
		auth.inviteError = e instanceof Error ? e.message : "Failed to accept invite";
	}
}

// ---------------------------------------------------------------------------
// Actions — Sign Out
// ---------------------------------------------------------------------------

/** Sign out and clear all stored state. */
export async function signOut(): Promise<void> {
	if (!_client) return;
	await _client.signOut();
	sessionStorage.removeItem(INVITE_STORAGE_KEY);
	auth.inviteToken = null;
	auth.inviteState = "none";
	auth.inviteError = null;
	auth.flowState = "idle";
	auth.errorMessage = null;
}
