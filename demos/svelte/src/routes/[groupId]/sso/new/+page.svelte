<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useConvexClient } from "convex-svelte";
  import NewConnectionForm from "$lib/components/sso/NewConnectionForm.svelte";

  let { data } = $props();
  const client = useConvexClient();
  const siteUrl = (page.data as { siteUrl?: string | null }).siteUrl ?? null;
</script>

<div class="col-span-full max-w-3xl mx-auto w-full px-8 py-10 flex flex-col gap-6 max-md:px-4 max-md:py-6">
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div>
      <h1 class="heading text-xl m-0">New connection</h1>
      <p class="m-0 mt-1 font-label text-[0.8125rem] text-gray-500">Create a group SSO connection.</p>
    </div>
    <a class="button button--secondary button--compact no-underline" href="/{data.groupId}/sso">Back</a>
  </div>

  <NewConnectionForm
    {client}
    groupId={data.groupId}
    {siteUrl}
    ondone={(connectionId) => {
      if (connectionId) {
        goto(`/${data.groupId}/sso/${connectionId}`);
        return;
      }
      goto(`/${data.groupId}/sso`);
    }}
  />
</div>
