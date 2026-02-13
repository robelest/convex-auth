/**
 * Svelte auth store — wraps the framework-agnostic convex-auth client
 * with Svelte 5 reactive state ($state).
 *
 * The portal uses the same Auth() instance as the main app.
 * Portal admins sign in via email magic link and are gated by
 * an accepted invite with `role: "portalAdmin"`.
 */
import { client as createAuthClient, type AuthState } from "@robelest/convex-auth/client";
import type { ConvexClient } from "convex/browser";

// ---------------------------------------------------------------------------
// Reactive state (module-level singletons)
// ---------------------------------------------------------------------------

/** Whether the auth client has been initialized. */
let _initialized = $state(false);

/** Current auth state from convex-auth. */
let _authState = $state<AuthState>({
	isLoading: true,
	isAuthenticated: false,
	token: null,
});

/** Invite token from URL `?invite=...` (only present on first visit). */
let _inviteToken = $state<string | null>(null);

/** UI flow state for the login form. */
let _flowState = $state<"idle" | "sending" | "sent" | "error">("idle");

/** Error message if something goes wrong. */
let _errorMessage = $state<string | null>(null);

// ---------------------------------------------------------------------------
// Auth client ref (set once during init)
// ---------------------------------------------------------------------------

let _auth: ReturnType<typeof createAuthClient> | null = null;

// ---------------------------------------------------------------------------
// Public reactive getters
// ---------------------------------------------------------------------------

export function getAuthState(): AuthState {
	return _authState;
}

export function getIsAuthenticated(): boolean {
	return _authState.isAuthenticated;
}

export function getIsLoading(): boolean {
	return _authState.isLoading;
}

export function getInviteToken(): string | null {
	return _inviteToken;
}

export function getFlowState(): typeof _flowState {
	return _flowState;
}

export function getErrorMessage(): string | null {
	return _errorMessage;
}

export function getInitialized(): boolean {
	return _initialized;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the auth client. Call once from the root layout after
 * `setupConvex()` has been called and a `ConvexClient` is available.
 *
 * The client auto-handles `?code=...` in the URL (magic link callback)
 * and hydrates from localStorage.
 */
export function initAuth(convex: ConvexClient): void {
	if (_initialized) return;

	// Extract invite token from URL before the auth client rewrites it
	if (typeof window !== "undefined") {
		const url = new URL(window.location.href);
		const invite = url.searchParams.get("invite");
		if (invite) {
			_inviteToken = invite;
			// Store in sessionStorage so it survives the magic link round-trip
			sessionStorage.setItem("__portalInviteToken", invite);
			// Clean the invite param from the URL
			url.searchParams.delete("invite");
			window.history.replaceState({}, "", url.pathname + url.search + url.hash);
		} else {
			// Restore from sessionStorage (after magic link redirect back)
			const stored = sessionStorage.getItem("__portalInviteToken");
			if (stored) {
				_inviteToken = stored;
			}
		}
	}

	_auth = createAuthClient({ convex });

	// Subscribe to auth state changes
	_auth.onChange((state) => {
		_authState = state;
	});

	_initialized = true;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Send a magic link email. The `redirectTo` URL should be the portal's
 * full URL so the user lands back here after clicking the link.
 *
 * @param email — The admin's email address
 * @param redirectTo — The portal URL (e.g. `https://xxx.convex.site/auth`)
 * @param provider — The email provider ID (default: auto-detect)
 */
export async function sendMagicLink(
	email: string,
	redirectTo: string,
	provider: string = "portal",
): Promise<void> {
	if (!_auth) throw new Error("Auth not initialized");

	_flowState = "sending";
	_errorMessage = null;

	try {
		await _auth.signIn(provider, { email, redirectTo });
		_flowState = "sent";
	} catch (e: any) {
		_flowState = "error";
		_errorMessage = e?.message ?? "Failed to send magic link";
	}
}

/**
 * Reset the flow state (e.g. to go back from "check your inbox" to the form).
 */
export function resetFlow(): void {
	_flowState = "idle";
	_errorMessage = null;
}

/**
 * Sign out the current user.
 */
export async function signOut(): Promise<void> {
	if (!_auth) return;
	await _auth.signOut();
	// Clear any stored invite token
	sessionStorage.removeItem("__portalInviteToken");
	_inviteToken = null;
	_flowState = "idle";
	_errorMessage = null;
}

/**
 * Clear the stored invite token after it has been accepted.
 */
export function clearInviteToken(): void {
	sessionStorage.removeItem("__portalInviteToken");
	_inviteToken = null;
}
