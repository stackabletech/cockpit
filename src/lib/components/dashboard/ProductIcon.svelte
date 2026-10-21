<script lang="ts">
  import type { Product } from '$lib/dashboard/products';

  type Size = 'sm' | 'md' | 'lg';

  let {
    product,
    size = 'sm',
    alt = ''
  }: {
    product: Product;
    size?: Size;
    /** Accessible name; leave empty when the surrounding element already names the product. */
    alt?: string;
  } = $props();

  const SIZES: Record<Size, { box: string; padding: string; text: string }> = {
    sm: { box: 'size-5 rounded-full', padding: 'p-0.5', text: 'text-[10px]' },
    md: { box: 'size-[38px] rounded-md', padding: 'p-1', text: 'font-mono text-xs' },
    lg: { box: 'size-10 rounded-xl', padding: 'p-1', text: 'text-sm' }
  };

  const classes = $derived(SIZES[size]);

  // Keyed by product id so it resets when the product changes (e.g. in the bookmark modal).
  let failedLogoFor = $state<string | null>(null);
  const showLogo = $derived(product.logo !== null && failedLogoFor !== product.id);
</script>

{#if showLogo && product.logo}
  <enhanced:img
    src={product.logo}
    {alt}
    class="bg-neutral-content shrink-0 object-contain {classes.box} {classes.padding}"
    onerror={() => (failedLogoFor = product.id)}
  />
{:else}
  <span
    class="flex shrink-0 items-center justify-center font-bold {classes.box} {classes.text}"
    style="background-color: {product.color}; color: {product.textColor}"
    role={alt ? 'img' : undefined}
    aria-label={alt || undefined}
    aria-hidden={alt ? undefined : 'true'}
  >
    {product.initials}
  </span>
{/if}
