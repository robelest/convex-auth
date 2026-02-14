<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import Icon from '$lib/components/ui/icon.svelte';
	import { signOut } from '$lib/stores/auth.svelte';

	const titles: Record<string, string> = {
		'/users': 'Users',
		'/sessions': 'Sessions',
		'/keys': 'API Keys',
	};

	function getTitle(): string {
		const path = auth.slug
			? page.url.pathname.replace(`/${auth.slug}`, '') || '/'
			: page.url.pathname.replace(base, '') || '/';
		return titles[path]
			?? (path.startsWith('/users/') ? 'User Detail' : 'Auth Portal');
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
			onclick={() => signOut()}
			class="flex items-center gap-1.5 text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text px-2 py-1 rounded-[var(--cp-radius-sm)] hover:bg-[var(--cp-hover)] transition-colors"
		>
			<Icon name="logout" size={12} />
			Sign out
		</button>
	</div>
</header>
