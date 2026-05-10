<script lang="ts">
	import AuthModal from "$lib/components/AuthModal.svelte";
	import ChangePasswordForm from "$lib/components/ChangePasswordForm.svelte";

	let { data } = $props();
</script>

{#if !data.auth.isAuthenticated || !data.user}
	<div class="flex w-full max-w-80 flex-col gap-3">
		<p class="muted text-center">Sign in to change your password.</p>
		<AuthModal authProviders={data.authProviders} />
	</div>
{:else}
	<div
		class="flex w-full max-w-80 flex-col gap-3 border border-gray-300 bg-white p-5 max-md:max-w-full max-md:p-4 max-md:border-x-0"
	>
		<h2 class="heading text-xl m-0">Change password</h2>
		<ChangePasswordForm email={data.user.email} />
	</div>
{/if}
