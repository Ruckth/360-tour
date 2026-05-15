<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import AIChatWidget from "$lib/components/chat/AIChatWidget.svelte";
  import { resort } from "$lib/data/resort-config";
  import { pageContext } from "$lib/stores/page-context.svelte";
  import { themeState } from "$lib/stores/theme.svelte";
  import PageLoadingOverlay from "./PageLoadingOverlay.svelte";
  import SiteFooter from "./SiteFooter.svelte";
  import SiteHeader from "./SiteHeader.svelte";

  let { children } = $props();

  let pageLoaded = $state(false);
  const canonicalUrl = $derived(page.url.href);
  const socialImageUrl = $derived(new URL("/garden-image.webp", page.url).href);

  onMount(() => {
    themeState.init();
    requestAnimationFrame(() => {
      pageLoaded = true;
    });
  });
</script>

<svelte:head>
  <meta name="description" content={resort.description} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={resort.name} />
  <meta property="og:title" content={`${resort.name} — ${resort.location}`} />
  <meta property="og:description" content={resort.description} />
  <meta property="og:image" content={socialImageUrl} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={`${resort.name} — ${resort.location}`} />
  <meta name="twitter:description" content={resort.description} />
  <meta name="twitter:image" content={socialImageUrl} />
</svelte:head>

{#if !pageLoaded}
  <PageLoadingOverlay />
{/if}

<div
  class="bg-background text-foreground flex min-h-screen flex-col transition-opacity duration-500 {pageLoaded
    ? 'opacity-100'
    : 'opacity-0'}"
>
  <SiteHeader />

  <main class="flex-1">
    {@render children()}
  </main>

  <SiteFooter />

  <AIChatWidget
    propertySlug={pageContext.propertySlug}
    propertyName={pageContext.propertyName}
    whatsappNumber={resort.whatsapp}
    lineId={resort.lineId}
  />
</div>
