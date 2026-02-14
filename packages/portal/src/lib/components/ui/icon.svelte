<script lang="ts">
	/**
	 * Unified icon component — eliminates duplicate inline SVGs.
	 *
	 * Usage: <Icon name="users" size={14} />
	 */

	// Each icon is its own SVG path/element string (raw inner SVG).
	// The component wraps it in a consistent <svg> container.
	const ICONS: Record<string, string> = {
		users: [
			'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>',
			'<circle cx="9" cy="7" r="4"/>',
			'<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
			'<path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
		].join(''),
		sessions: [
			'<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>',
			'<line x1="8" y1="21" x2="16" y2="21"/>',
			'<line x1="12" y1="17" x2="12" y2="21"/>',
		].join(''),
		keys: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
		shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
		logout: [
			'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
			'<polyline points="16 17 21 12 16 7"/>',
			'<line x1="21" y1="12" x2="9" y2="12"/>',
		].join(''),
		email: [
			'<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>',
			'<polyline points="22,6 12,13 2,6"/>',
		].join(''),
		error: [
			'<circle cx="12" cy="12" r="10"/>',
			'<line x1="15" y1="9" x2="9" y2="15"/>',
			'<line x1="9" y1="9" x2="15" y2="15"/>',
		].join(''),
		warning: [
			'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>',
			'<line x1="12" y1="9" x2="12" y2="13"/>',
			'<line x1="12" y1="17" x2="12.01" y2="17"/>',
		].join(''),
	};

	type IconName = keyof typeof ICONS;

	interface Props {
		name: IconName;
		size?: number;
		class?: string;
		strokeWidth?: number;
		color?: string;
	}

	let {
		name,
		size = 14,
		class: className = '',
		strokeWidth = 2,
		color,
	}: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke={color ?? 'currentColor'}
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
>
	{@html ICONS[name] ?? ''}
</svg>
