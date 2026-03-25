<script lang="ts">
  let { children } = $props();
</script>

<div class="col-span-full min-h-dvh">
  {@render children()}
</div>
