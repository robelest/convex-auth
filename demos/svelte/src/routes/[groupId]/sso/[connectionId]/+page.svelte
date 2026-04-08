<script lang="ts">
  import { page } from "$app/state";
  import { useConvexClient } from "convex-svelte";
  import ConnectionDetail from "$lib/components/sso/ConnectionDetail.svelte";

  let { data } = $props();
  const client = useConvexClient();
  const siteUrl = (page.data as { siteUrl?: string | null }).siteUrl ?? null;
</script>

<ConnectionDetail
  {client}
  groupId={data.groupId}
  connectionId={data.connectionId}
  {siteUrl}
/>
