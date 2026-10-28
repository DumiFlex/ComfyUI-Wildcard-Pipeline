<script setup lang="ts">
/**
 * Diff view: what changed between two texts, word by word (an option, a
 * template) or line by line (a pack, a log). Removed text is struck through
 * on red, added text is on green, and each change also says "removed" /
 * "added" to screen readers, so colour is never the only sign. Works on the
 * canvas and in the manager.
 *
 *   <DiffView before="auburn hair, rim light" after="silver hair, rim light" />
 *   <DiffView :before="oldJson" :after="newJson" by="lines" layout="split" />
 *
 * `layout="split"` shows Before and After side by side. Very long texts fall
 * back to "all removed, all added" rather than freeze the page.
 */
import { computed } from "vue";
import { diffText } from "./diff";

const props = withDefaults(defineProps<{
  before: string;
  after: string;
  by?: "words" | "lines";
  layout?: "inline" | "split";
  size?: "sm" | "md";
  /** Mono font, for code and JSON. */
  mono?: boolean;
}>(), { by: "words", layout: "inline", size: "md" });

const parts = computed(() => diffText(props.before, props.after, props.by));
const counts = computed(() => ({
  add: parts.value.filter((p) => p.kind === "add").length,
  del: parts.value.filter((p) => p.kind === "del").length,
}));
</script>

<template>
  <div class="wp-diff" :data-size="size" :data-layout="layout" :data-by="by" :data-mono="mono || by === 'lines' || undefined">
    <p v-if="!counts.add && !counts.del" class="wp-diff__same">No changes</p>
    <template v-else-if="layout === 'inline'">
      <div class="wp-diff__text"><template v-for="(p, i) in parts" :key="i"><span v-if="p.kind === 'same'">{{ p.text }}</span><del v-else-if="p.kind === 'del'" class="wp-diff__del"><span class="wp-diff__sr">removed: </span>{{ p.text }}</del><ins v-else class="wp-diff__add"><span class="wp-diff__sr">added: </span>{{ p.text }}</ins></template></div>
    </template>
    <div v-else class="wp-diff__split">
      <section class="wp-diff__side" aria-label="Before">
        <span class="wp-diff__side-label" aria-hidden="true">Before</span>
        <div class="wp-diff__text"><template v-for="(p, i) in parts" :key="i"><span v-if="p.kind === 'same'">{{ p.text }}</span><del v-else-if="p.kind === 'del'" class="wp-diff__del"><span class="wp-diff__sr">removed: </span>{{ p.text }}</del></template></div>
      </section>
      <section class="wp-diff__side" aria-label="After">
        <span class="wp-diff__side-label" aria-hidden="true">After</span>
        <div class="wp-diff__text"><template v-for="(p, i) in parts" :key="i"><span v-if="p.kind === 'same'">{{ p.text }}</span><ins v-else-if="p.kind === 'add'" class="wp-diff__add"><span class="wp-diff__sr">added: </span>{{ p.text }}</ins></template></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.wp-diff { min-width: 0; color: var(--wp-text); font: 400 var(--wp-text-sm)/1.6 var(--wp-font-sans); }
.wp-diff[data-size="sm"] { font-size: var(--wp-text-xs); }
.wp-diff[data-mono] { font-family: var(--wp-font-mono); }
.wp-diff__text { white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-diff__del, .wp-diff__add { border-radius: min(3px, var(--wp-radius-cap, 999px)); padding: 0 1px; text-decoration-thickness: 1px; }
.wp-diff__del { background: color-mix(in srgb, var(--wp-danger) 16%, transparent); color: var(--wp-danger-text); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--wp-danger) 70%, transparent); }
.wp-diff__add { background: color-mix(in srgb, var(--wp-success) 18%, transparent); color: var(--wp-text); text-decoration: none; box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--wp-success) 60%, transparent); }
.wp-diff[data-by="lines"] .wp-diff__del, .wp-diff[data-by="lines"] .wp-diff__add { display: block; padding: 0 var(--wp-space-2); border-radius: 0; }
.wp-diff__split { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--wp-space-4); }
.wp-diff__side { min-width: 0; padding: var(--wp-space-3) var(--wp-space-4); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); background: var(--wp-bg-1); }
.wp-diff__side-label { display: block; margin-bottom: var(--wp-space-2); color: var(--wp-text-dim); font: 600 var(--wp-text-xs)/1 var(--wp-font-sans); letter-spacing: 0.06em; text-transform: uppercase; }
.wp-diff__same { margin: 0; color: var(--wp-text-dim); font-style: italic; }
.wp-diff__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
