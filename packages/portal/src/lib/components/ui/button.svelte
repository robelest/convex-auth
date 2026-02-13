<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md';
		children: Snippet;
	}

	let { variant = 'secondary', size = 'sm', children, ...rest }: Props = $props();

	const variantClasses: Record<string, string> = {
		primary: 'bg-cp-accent text-white hover:bg-cp-accent-hover',
		secondary: 'bg-cp-bg-secondary text-cp-text-secondary hover:bg-cp-bg-tertiary hover:text-cp-text',
		danger: 'bg-cp-error/15 text-cp-error hover:bg-cp-error/25',
		ghost: 'text-cp-text-secondary hover:bg-cp-hover hover:text-cp-text',
	};

	const sizeClasses: Record<string, string> = {
		sm: 'px-2.5 py-1 text-[var(--cp-text-sm)]',
		md: 'px-3 py-1.5 text-[var(--cp-text-base)]',
	};
</script>

<button
	class="inline-flex items-center justify-center gap-1.5 rounded-[var(--cp-radius-sm)] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed {variantClasses[variant]} {sizeClasses[size]}"
	{...rest}
>
	{@render children()}
</button>
