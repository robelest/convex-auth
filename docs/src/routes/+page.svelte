<script>
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import ArrowSquareOut from 'phosphor-svelte/lib/ArrowSquareOut';
</script>

<svelte:head>
	<title>convex-auth — Component-first authentication for Convex</title>
	<meta name="description" content="One component, one setup API, full TypeScript support." />
</svelte:head>

<h1 class="hero-title">convex-auth</h1>
<p class="hero-tagline"><em>One component, one setup API, full TypeScript support.</em></p>

<div class="hero-actions">
	<a href="/getting-started/installation/" class="btn-primary">
		Get Started <CaretRight size={16} weight="bold" />
	</a>
	<a href="https://github.com/robelest/convex-auth" class="btn-minimal">
		GitHub <ArrowSquareOut size={14} />
	</a>
</div>

<div class="card-grid">
	<div class="card">
		<p class="card-title">Convex-native</p>
		<p><code>createAuth(components.auth, {'{providers}'})</code> — auth, helpers, and HTTP in one call.</p>
	</div>
	<div class="card">
		<p class="card-title">Every auth method</p>
		<p>Password, OAuth, magic links, passkeys, TOTP, anonymous, device flow, phone.</p>
	</div>
	<div class="card">
		<p class="card-title">Groups & memberships</p>
		<p>Hierarchical groups with roles, invites, and cascade deletes.</p>
	</div>
	<div class="card">
		<p class="card-title">API keys</p>
		<p>Scoped permissions, SHA-256 hashing, per-key rate limiting, rotation.</p>
	</div>
	<div class="card">
		<p class="card-title">Enterprise SSO</p>
		<p>OIDC, SAML 2.0, SCIM 2.0 via <code>new SSO()</code>. Conditional TypeScript gating.</p>
	</div>
	<div class="card">
		<p class="card-title">SSR ready</p>
		<p>Cookie API for SvelteKit, TanStack Start, and Next.js.</p>
	</div>
</div>

<style>
	.hero-title {
		font-family: var(--font-sans);
		font-size: 3rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.2;
		margin-bottom: 0.5rem;
	}

	.hero-tagline {
		font-size: 1.125rem;
		color: var(--color-gray-600);
		margin-bottom: 2rem;
	}

	:global([data-theme='dark']) .hero-tagline {
		color: var(--color-gray-400);
	}

	.hero-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 4rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1.25rem;
		background-color: var(--color-accent-500);
		color: var(--color-gray-50);
		text-decoration: none;
		font-size: 0.875rem;
		font-weight: 500;
		border: 1px solid var(--color-accent-500);
		transition: background-color 0.15s ease;
	}

	.btn-primary:hover {
		background-color: var(--color-accent-600);
		color: var(--color-gray-50);
	}

	.btn-minimal {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		color: var(--color-gray-600);
		text-decoration: none;
		font-size: 0.875rem;
	}

	:global([data-theme='dark']) .btn-minimal {
		color: var(--color-gray-400);
	}

	.btn-minimal:hover {
		color: var(--color-gray-900);
	}

	.card-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	@media (min-width: 640px) {
		.card-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.card {
		border: 1px solid var(--color-gray-300);
		padding: 1.25rem;
	}

	:global([data-theme='dark']) .card {
		border-color: var(--color-gray-700);
	}

	.card-title {
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.card p:last-child {
		font-size: 0.875rem;
		color: var(--color-gray-600);
		margin: 0;
	}

	:global([data-theme='dark']) .card p:last-child {
		color: var(--color-gray-400);
	}

	.card code {
		font-family: var(--font-mono);
		font-size: 0.8125em;
		background: var(--color-gray-200);
		padding: 0.125rem 0.3rem;
		border: 1px solid var(--color-gray-300);
	}

	:global([data-theme='dark']) .card code {
		background: var(--color-gray-800);
		border-color: var(--color-gray-700);
	}
</style>
