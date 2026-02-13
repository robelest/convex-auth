<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	interface Props {
		data: T[];
		columns: {
			key: string;
			label: string;
			width?: string;
			align?: 'left' | 'right' | 'center';
		}[];
		row: Snippet<[T]>;
		loading?: boolean;
		emptyTitle?: string;
		emptyDescription?: string;
		onRowClick?: (item: T) => void;
	}

	let {
		data,
		columns,
		row,
		loading = false,
		emptyTitle = 'No data',
		emptyDescription,
		onRowClick,
	}: Props = $props();
</script>

<div class="overflow-x-auto">
	<table class="w-full text-[var(--cp-text-sm)]">
		<thead>
			<tr class="border-b border-cp-border">
				{#each columns as col}
					<th
						class="px-4 py-2 text-left text-[var(--cp-text-xs)] font-medium text-cp-text-muted uppercase tracking-wider whitespace-nowrap"
						style={col.width ? `width: ${col.width}` : ''}
						class:text-right={col.align === 'right'}
						class:text-center={col.align === 'center'}
					>
						{col.label}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if loading}
				{#each Array(5) as _}
					<tr class="border-b border-cp-border/50">
						{#each columns as _col}
							<td class="px-4 py-2.5">
								<div class="cp-skeleton h-3 w-24 rounded"></div>
							</td>
						{/each}
					</tr>
				{/each}
			{:else if data.length === 0}
				<tr>
					<td colspan={columns.length} class="px-4 py-8">
						<div class="flex flex-col items-center justify-center text-center">
							<p class="text-[var(--cp-text-sm)] text-cp-text-secondary">{emptyTitle}</p>
							{#if emptyDescription}
								<p class="text-[var(--cp-text-xs)] text-cp-text-muted mt-0.5">{emptyDescription}</p>
							{/if}
						</div>
					</td>
				</tr>
			{:else}
				{#each data as item}
					<tr
						class="border-b border-cp-border/50 transition-colors hover:bg-cp-hover {onRowClick ? 'cursor-pointer' : ''}"
						onclick={() => onRowClick?.(item)}
					>
						{@render row(item)}
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
