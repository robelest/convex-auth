<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { signOut } from '$lib/stores/auth.svelte';

	const titles: Record<string, string> = {
		'/users': 'Users',
		'/sessions': 'Sessions',
	};

	function getTitle(): string {
		const path = page.url.pathname.replace(base, '') || '/';
		if (titles[path]) return titles[path];
		if (path.startsWith('/users/')) return 'User Detail';
		return 'Auth Portal';
	}

	async function handleLogout() {
		await signOut();
	}
</script>

<header
	class="flex items-center justify-between h-[var(--cp-header-height)] px-6 border-b border-cp-border bg-cp-bg shrink-0"
>
	<h1 class="text-[var(--cp-text-md)] font-medium text-cp-text">{getTitle()}</h1>

	<div class="flex items-center gap-3">
		<div class="text-[var(--cp-text-xs)] text-cp-text-muted font-mono">
			{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
		</div>

		<button
			onclick={handleLogout}
			class="flex items-center gap-1.5 text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text px-2 py-1 rounded-[var(--cp-radius-sm)] hover:bg-[var(--cp-hover)] transition-colors"
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
				<polyline points="16 17 21 12 16 7" />
				<line x1="21" y1="12" x2="9" y2="12" />
			</svg>
			Sign out
		</button>
	</div>
</header>
