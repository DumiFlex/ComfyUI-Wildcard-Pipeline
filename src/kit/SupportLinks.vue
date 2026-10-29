<script setup lang="ts">
/**
 * The "support the project" link cards on an About page: one card per way to
 * give, each with an icon, a label, a line of detail and an outside-link mark.
 * The apps keep the list itself (where the money goes is theirs to say) and
 * pass it in, so the extension and the community site show the same cards.
 */
export interface SupportLink {
  /** Stable id: the card's `data-kind`. */
  id: string;
  label: string;
  detail?: string | undefined;
  /** PrimeIcons class, `pi-heart`. */
  icon: string;
  href: string;
}

withDefaults(defineProps<{ links: readonly SupportLink[]; label?: string | undefined }>(), {
  label: "Ways to support the project",
});
</script>

<template>
  <ul class="wp-support" :aria-label="label">
    <li v-for="link in links" :key="link.id">
      <a class="wp-support__link" :data-kind="link.id" :href="link.href" target="_blank" rel="noopener">
        <span class="wp-support__icon"><i :class="['pi', link.icon]" aria-hidden="true" /></span>
        <span class="wp-support__text">
          <span class="wp-support__label">{{ link.label }}</span>
          <span v-if="link.detail" class="wp-support__detail">{{ link.detail }}</span>
        </span>
        <i class="pi pi-external-link wp-support__out" aria-hidden="true" />
        <span class="wp-support__sr">(opens in a new tab)</span>
      </a>
    </li>
  </ul>
</template>

<style scoped>
.wp-support {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--wp-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.wp-support__link {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  height: 100%;
  box-sizing: border-box;
  padding: var(--wp-space-4) var(--wp-space-5);
  border: 1px solid var(--wp-border);
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1);
  color: var(--wp-text);
  text-decoration: none;
  transition: border-color var(--wp-motion-hover, 120ms) ease-out, background-color var(--wp-motion-hover, 120ms) ease-out;
}
.wp-support__link:hover {
  border-color: var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 8%, var(--wp-bg-1));
}
.wp-support__link:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}
.wp-support__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2);
  color: var(--wp-accent-text);
  font-size: 16px;
}
.wp-support__text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.wp-support__label { font-weight: 600; font-size: var(--wp-text-sm); }
.wp-support__detail { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-support__out { color: var(--wp-text-dim); flex: none; font-size: 12px; }
.wp-support__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
