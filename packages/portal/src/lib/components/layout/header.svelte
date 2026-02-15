<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { auth } from '$lib/stores/auth.svelte';
	import { LogOut } from '@lucide/svelte';
	import { signOut } from '$lib/stores/auth.svelte';

	const titles: Record<string, string> = {
		'/users': 'Users',
		'/groups': 'Groups',
		'/sessions': 'Sessions',
		'/keys': 'API Keys',
	};

	function getTitle(): string {
		const path = auth.slug
			? page.url.pathname.replace(`/${auth.slug}`, '') || '/'
			: page.url.pathname.replace(base, '') || '/';
		return titles[path]
			?? (path.startsWith('/users/') ? 'User Detail'
				: path.startsWith('/groups/') ? 'Group Detail'
				: 'Auth Portal');
	}
</script>

<header
	class="flex items-center justify-between h-[var(--cp-header-height)] px-6 border-b border-border bg-background shrink-0"
>
	<h1 class="text-[var(--cp-text-md)] font-medium text-foreground">{getTitle()}</h1>

	<div class="flex items-center gap-3">
		<div class="text-[var(--cp-text-xs)] text-muted-foreground font-mono">
			{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
		</div>

		<button
			onclick={() => signOut()}
			class="flex items-center gap-1.5 text-[var(--cp-text-xs)] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors"
		>
			<LogOut size={12} />
			Sign out
		</button>
	</div>
</header>
