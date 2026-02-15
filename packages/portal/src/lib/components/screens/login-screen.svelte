<script lang="ts">
	import { ShieldCheck, Mail } from '@lucide/svelte';
	import { auth, sendMagicLink, resetFlow } from '$lib/stores/auth.svelte';

	interface Props {
		inviteToken: string | null;
	}

	let { inviteToken }: Props = $props();
	let email = $state('');

	const flowState = $derived(auth.flowState);
	const errorCode = $derived(auth.errorCode);
	const errorMessage = $derived(auth.errorMessage);

	/** Map error codes to user-friendly portal messages. */
	const ERROR_DISPLAY: Record<string, { title: string; hint: string }> = {
		PORTAL_NOT_AUTHORIZED: {
			title: 'Not authorized',
			hint: 'This email is not a portal admin. Ask an existing admin for an invite link.',
		},
		EMAIL_SEND_FAILED: {
			title: 'Email failed',
			hint: 'Could not send the magic link email. Check your server email configuration.',
		},
		EMAIL_CONFIG_REQUIRED: {
			title: 'Email not configured',
			hint: 'The server has no email transport configured. Add an email config to your Auth constructor.',
		},
	};

	const errorDisplay = $derived(errorCode ? ERROR_DISPLAY[errorCode] : null);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!email.trim()) return;
		await sendMagicLink(email.trim());
	}
</script>

<div class="flex items-center justify-center h-screen bg-cp-bg text-cp-text">
	<div class="max-w-md w-full mx-4 rounded-[var(--cp-radius-lg)] border border-cp-border bg-cp-bg-secondary p-8">
		<!-- Logo -->
		<div
			class="w-12 h-12 rounded-[var(--cp-radius-md)] bg-[rgba(99,168,248,0.1)] border border-[rgba(99,168,248,0.2)] flex items-center justify-center mb-6"
		>
			<ShieldCheck size={24} color="var(--cp-accent)" />
		</div>

		<h1 class="text-[var(--cp-text-lg)] font-semibold mb-1">Admin Portal</h1>

		{#if inviteToken}
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-6">
				You've been invited as a portal admin. Enter your email to sign in.
			</p>
		{:else}
			<p class="text-[var(--cp-text-sm)] text-cp-text-muted mb-6">
				Sign in with your email to access the auth administration dashboard.
			</p>
		{/if}

		{#if flowState === 'sent'}
			<!-- Check your inbox -->
			<div class="rounded-[var(--cp-radius-md)] bg-[rgba(99,168,248,0.08)] border border-[rgba(99,168,248,0.2)] p-4 mb-4">
				<p class="text-[var(--cp-text-sm)] text-[var(--cp-accent)] font-medium mb-1">
					Check your inbox
				</p>
				<p class="text-[var(--cp-text-xs)] text-cp-text-muted leading-relaxed">
					We sent a magic link to <strong class="text-cp-text-secondary">{email}</strong>.
					Click the link in the email to sign in.
				</p>
			</div>
			<button
				onclick={resetFlow}
				class="text-[var(--cp-text-xs)] text-cp-text-muted hover:text-cp-text transition-colors"
			>
				Use a different email
			</button>
		{:else}
			<!-- Email input form -->
			<form onsubmit={handleSubmit} class="space-y-3">
				<div>
					<label for="email" class="block text-[var(--cp-text-xs)] text-cp-text-secondary mb-1.5">
						Email address
					</label>
					<input
						id="email"
						type="email"
						bind:value={email}
						placeholder="admin@example.com"
						required
						class="w-full rounded-[var(--cp-radius-md)] border border-cp-border bg-cp-bg px-3 py-2 text-[var(--cp-text-sm)] text-cp-text placeholder:text-cp-text-muted focus:outline-none focus:border-[var(--cp-accent)] transition-colors"
					/>
				</div>

			{#if flowState === 'error' && errorMessage}
				<div class="rounded-[var(--cp-radius-md)] bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)] px-3 py-2">
					{#if errorDisplay}
						<p class="text-[var(--cp-text-xs)] text-[var(--cp-error)] font-medium">{errorDisplay.title}</p>
						<p class="text-[var(--cp-text-xs)] text-cp-text-muted mt-0.5">{errorDisplay.hint}</p>
					{:else}
						<p class="text-[var(--cp-text-xs)] text-[var(--cp-error)]">{errorMessage}</p>
					{/if}
				</div>
			{/if}

				<button
					type="submit"
					disabled={flowState === 'sending' || !email.trim()}
					class="flex items-center justify-center gap-2 w-full rounded-[var(--cp-radius-md)] bg-cp-accent text-[#0a0a0b] font-medium text-[var(--cp-text-sm)] px-4 py-2.5 hover:bg-cp-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{#if flowState === 'sending'}
						<div class="w-4 h-4 border-2 border-[#0a0a0b]/30 border-t-[#0a0a0b] rounded-full animate-spin"></div>
						Sending...
					{:else}
						<Mail size={14} />
						Send magic link
					{/if}
				</button>
			</form>
		{/if}
	</div>
</div>
