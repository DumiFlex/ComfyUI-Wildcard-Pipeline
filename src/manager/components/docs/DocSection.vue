<script setup lang="ts">
import { inject, onBeforeUnmount } from "vue";
import CopyButton from "@/components/shared/CopyButton.vue";
import { DOC_OUTLINE, sectionSlug } from "../../docs/outline";

const props = defineProps<{ title: string }>();

// Joins the page's "On this page" list; the id is the section's link anchor.
const outline = inject(DOC_OUTLINE, null);
const id = outline ? outline.add(props.title) : `s-${sectionSlug(props.title)}`;
onBeforeUnmount(() => outline?.remove(id));

function link(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}#${id}`;
}
</script>
<template>
  <section :id="id" class="wp-doc-section">
    <h2 class="wp-doc-section__h2">
      <span class="wp-doc-section__title">{{ title }}</span>
      <CopyButton class="wp-doc-section__link" :text="link" label="Copy link to this section" icon="pi-link" size="sm" />
    </h2>
    <div class="wp-doc-section__body"><slot /></div>
  </section>
</template>
<style scoped>
/* Room under the sticky "Ask about this page" bar when a link scrolls here. */
.wp-doc-section { scroll-margin-top: 16px; }
.wp-doc-section__h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--wp-text-muted); font-weight: 600; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.wp-doc-section__h2::after { content: ""; flex: 1; height: 1px; background: var(--wp-border); }
/* The link button shows on hover and keyboard focus, so headings stay quiet. */
.wp-doc-section__link { opacity: 0; transition: opacity var(--wp-motion-hover, 120ms); }
.wp-doc-section__h2:hover .wp-doc-section__link,
.wp-doc-section__link:focus-visible,
.wp-doc-section__link[data-state="copied"] { opacity: 1; }
@media (hover: none) { .wp-doc-section__link { opacity: 1; } }
/* Flex column so every block — paragraphs, lists, key-lists, callouts,
 * and images — gets even vertical rhythm. Fixes images sitting flush
 * against the text above them. */
.wp-doc-section__body { display: flex; flex-direction: column; gap: 16px; font-size: 13.5px; line-height: 1.66; color: var(--wp-text); }
.wp-doc-section__body :deep(p) { margin: 0; }
.wp-doc-section__body :deep(ul), .wp-doc-section__body :deep(ol) { margin: 0; padding-left: 20px; }
.wp-doc-section__body :deep(li) { margin-bottom: 8px; line-height: 1.6; }
.wp-doc-section__body :deep(li:last-child) { margin-bottom: 0; }
/* Key terms pop with accent color, so highlights aren't carried by bold alone. */
.wp-doc-section__body :deep(b), .wp-doc-section__body :deep(strong) { color: var(--wp-accent-text); font-weight: 600; }
</style>
