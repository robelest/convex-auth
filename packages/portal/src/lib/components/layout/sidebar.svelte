<script lang="ts">
	import { page } from '$app/state';
	import { portalHref, signOut } from '$lib/stores/auth.svelte';
	import { Users, Monitor, Key, ShieldCheck, UsersRound, LogOut } from '@lucide/svelte';
	import type { Component } from 'svelte';

	const navItems: { label: string; href: string; icon: Component }[] = [
		{ label: 'Users', href: portalHref('/users'), icon: Users },
		{ label: 'Groups', href: portalHref('/groups'), icon: UsersRound },
		{ label: 'Sessions', href: portalHref('/sessions'), icon: Monitor },
		{ label: 'API Keys', href: portalHref('/keys'), icon: Key },
	];

	function isActive(href: string): boolean {
		return page.url.pathname.startsWith(href);
	}
</script>

<aside
	class="flex flex-col w-[var(--cp-sidebar-width)] border-r border-border bg-background shrink-0"
>
	<!-- Logo / Title -->
	<div class="flex items-center gap-2 h-[var(--cp-header-height)] px-4 border-b border-border">
		<div class="w-5 h-5 rounded bg-primary flex items-center justify-center">
			<ShieldCheck class="text-primary-foreground" size={12} strokeWidth={2.5} />
		</div>
		<span class="font-semibold text-[var(--cp-text-md)] text-foreground">Auth Portal</span>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 py-2 px-2">
		{#each navItems as item}
			<a
				href={item.href}
				class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[var(--cp-text-sm)] transition-colors {isActive(item.href)
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
			>
				<item.icon size={14} />
				{item.label}
			</a>
		{/each}
	</nav>

	<!-- Sign out -->
	<div class="px-2 py-3 border-t border-border">
		<button
			onclick={() => signOut()}
			class="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-[var(--cp-text-sm)] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
		>
			<LogOut size={14} />
			Sign out
		</button>
	</div>
</aside>
