<script setup lang="ts">
/**
 * Small monospace, click-to-copy chip that surfaces a module/bundle's
 * identity in the edit-modal header. Debugging aid (workstream C / issue #4):
 * the library `id` is the uuid that `@{id}` nested refs, constraint
 * source/target, and library rows all match on — so seeing it (and being
 * able to copy it) makes drift/linking bugs traceable at a glance.
 *
 * Shows the library `id` as the visible label; the instance `_uid` (what
 * constraint `pick` + `bundle_origin` key on) rides along in the tooltip so
 * both identities are one hover away without cluttering the header.
 */
import { ref, onBeforeUnmount } from "vue";

const props = defineProps<{
  /** Library uuid — the payload row id. Matches `@{id}`, constraint
   *  source/target ids, and library rows. Empty for inline-only modules. */
  id: string;
  /** Instance uid — per-Context-node instance identity used by constraint
   *  `pick` selectors + `bundle_origin`. Optional (absent on some surfaces). */
  uid?: string;
}>();

const copied = ref(false);
let timer: number | undefined;

async function copyId(): Promise<void> {
  if (!props.id) return;
  try {
    await navigator.clipboard.writeText(props.id);
    copied.value = true;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => { copied.value = false; }, 1200);
  } catch {
    // Clipboard blocked (insecure context / denied) — the id stays visible
    // for manual selection, so a failed copy is a silent no-op.
  }
}

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>

<template>
  <button
    v-if="id"
    type="button"
    class="wp-idchip"
    :class="{ 'wp-idchip--copied': copied }"
    :title="`library id: ${id}${uid ? `\ninstance uid: ${uid}` : ''}\n(click to copy id)`"
    data-test="instance-id-chip"
    @click.stop="copyId"
  >
    <i
      class="pi wp-idchip__icon"
      :class="copied ? 'pi-check' : 'pi-hashtag'"
      aria-hidden="true"
    />
    <span class="wp-idchip__id">{{ copied ? "copied" : id }}</span>
  </button>
</template>

<style scoped>
.wp-idchip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid var(--wp-border, #33333f);
  border-radius: var(--wp-radius-sm, 4px);
  background: var(--wp-bg2, #1b1b22);
  color: var(--wp-text-dim, #8a8a99);
  font: 500 10px/1.4 var(--wp-font-mono, ui-monospace, "JetBrains Mono", monospace);
  letter-spacing: 0.02em;
  cursor: pointer;
  user-select: none;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.wp-idchip:hover {
  color: var(--wp-text, #e7e7ee);
  border-color: color-mix(in oklab, var(--wp-accent, #7c6ad6) 55%, var(--wp-border, #33333f));
}
.wp-idchip__icon {
  font-size: 9px;
  opacity: 0.8;
}
.wp-idchip__id {
  font-family: inherit;
}
.wp-idchip--copied {
  color: var(--wp-green, #6ad28b);
  border-color: color-mix(in oklab, var(--wp-green, #6ad28b) 55%, transparent);
}
</style>
