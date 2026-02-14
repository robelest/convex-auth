<script lang="ts">
	import { page } from '$app/state';
	import { portalHref } from '$lib/stores/auth.svelte';
	import Icon from '$lib/components/ui/icon.svelte';

	type IconName = 'users' | 'sessions' | 'keys';

	const navItems: { label: string; href: string; icon: IconName }[] = [
		{ label: 'Users', href: portalHref('/users'), icon: 'users' },
		{ label: 'Sessions', href: portalHref('/sessions'), icon: 'sessions' },
		{ label: 'API Keys', href: portalHref('/keys'), icon: 'keys' },
	];

	function isActive(href: string): boolean {
		return page.url.pathname.startsWith(href);
	}
</script>

<aside
	class="flex flex-col w-[var(--cp-sidebar-width)] border-r border-cp-border bg-cp-bg shrink-0"
>
	<!-- Logo / Title -->
	<div class="flex items-center gap-2 h-[var(--cp-header-height)] px-4 border-b border-cp-border">
		<div class="w-5 h-5 rounded bg-cp-accent flex items-center justify-center">
			<Icon name="shield" size={12} class="text-white" strokeWidth={2.5} />
		</div>
		<span class="font-semibold text-[var(--cp-text-md)] text-cp-text">Auth Portal</span>
	</div>

	<!-- Navigation -->
	<nav class="flex-1 py-2 px-2">
		{#each navItems as item}
			<a
				href={item.href}
				class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--cp-radius-sm)] text-[var(--cp-text-sm)] transition-colors {isActive(item.href)
					? 'bg-cp-active text-cp-text'
					: 'text-cp-text-secondary hover:bg-cp-hover hover:text-cp-text'}"
			>
				<Icon name={item.icon} size={14} />
				{item.label}
			</a>
		{/each}
	</nav>

	<!-- Footer -->
	<div class="px-3 py-3 border-t border-cp-border">
		<div class="text-[var(--cp-text-xs)] text-cp-text-muted">
			Convex Auth Portal
		</div>
	</div>
</aside>
