<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import { signOut } from '$lib/stores/auth.svelte';
</script>

<div class="flex items-center justify-center h-screen bg-background text-foreground">
	<div class="max-w-md w-full mx-4 rounded-lg border bg-card p-8 text-center">
		<div class="w-12 h-12 rounded-full bg-[rgba(252,211,77,0.1)] flex items-center justify-center mx-auto mb-4">
			<TriangleAlert size={24} color="var(--cp-warning)" />
		</div>
		<h2 class="text-[var(--cp-text-md)] font-medium mb-2">Access Denied</h2>
		<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-4">
			You're signed in but don't have portal admin access.
			Ask an existing admin to generate an invite link.
		</p>
		<button
			onclick={() => signOut()}
			class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
		>
			Sign out
		</button>
	</div>
</div>
