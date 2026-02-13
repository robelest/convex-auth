<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';

	const navItems = [
		{
			label: 'Users',
			href: `${base}/users`,
			icon: 'users',
		},
		{
			label: 'Sessions',
			href: `${base}/sessions`,
			icon: 'sessions',
		},
		{
			label: 'API Keys',
			href: `${base}/keys`,
			icon: 'keys',
		},
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
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-white">
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
			</svg>
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
				{#if item.icon === 'users'}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
						<circle cx="9" cy="7" r="4"/>
						<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
						<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
					</svg>
			{:else if item.icon === 'sessions'}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
					<line x1="8" y1="21" x2="16" y2="21"/>
					<line x1="12" y1="17" x2="12" y2="21"/>
				</svg>
			{:else if item.icon === 'keys'}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
				</svg>
			{/if}
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
