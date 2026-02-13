<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent' | 'muted';
		children: Snippet;
	}

	let { variant = 'default', children }: Props = $props();

	const variantClasses: Record<string, string> = {
		default: 'bg-cp-bg-tertiary text-cp-text-secondary',
		success: 'bg-cp-success/15 text-cp-success',
		warning: 'bg-cp-warning/15 text-cp-warning',
		error: 'bg-cp-error/15 text-cp-error',
		info: 'bg-cp-info/15 text-cp-info',
		accent: 'bg-cp-accent/15 text-cp-accent',
		muted: 'bg-cp-bg-secondary text-cp-text-muted',
	};
</script>

<span
	class="inline-flex items-center px-1.5 py-0.5 rounded-[var(--cp-radius-sm)] text-[var(--cp-text-xs)] font-medium leading-none whitespace-nowrap {variantClasses[variant]}"
>
	{@render children()}
</span>
