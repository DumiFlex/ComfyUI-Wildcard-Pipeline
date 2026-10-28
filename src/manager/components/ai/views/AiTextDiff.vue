<script setup lang="ts">
/**
 * AiTextDiff — a combine's or template's text old → new, word by word:
 * words the change takes out struck through in red, words it puts in
 * green, the rest as it was, prompt syntax coloured. Under it, the
 * variables the change starts or stops reading.
 */
import type { CardView } from "../../../composables/card-views/types";
import AiSyntax from "../AiSyntax.vue";

type View = Extract<CardView, { kind: "text-diff" }>;
defineProps<{ view: View; full?: boolean }>();
</script>

<template>
  <div class="wp-ai-textdiff" data-test="ai-card-text-diff">
    <dl class="wp-ai-textdiff__rows">
      <template v-for="r in view.rows" :key="r.label">
        <dt>{{ r.label }}</dt>
        <dd :class="{ 'wp-ai-textdiff__clamp': !full }">
          <span v-for="(part, i) in r.parts" :key="i" class="wp-ai-textdiff__part" :data-change="part.change"><AiSyntax :text="part.text" /></span>
          <span v-if="!r.parts.length" class="wp-ai-diff__none">none</span>
        </dd>
      </template>
    </dl>
    <p v-if="view.reads.added.length || view.reads.removed.length" class="wp-ai-textdiff__reads" data-test="ai-card-reads">
      <template v-if="view.reads.added.length">Now reads <code v-for="v in view.reads.added" :key="v" class="wp-ai-diff__chip" data-change="added">${{ v }}</code></template>
      <template v-if="view.reads.added.length && view.reads.removed.length"> · </template>
      <template v-if="view.reads.removed.length">No longer reads <code v-for="v in view.reads.removed" :key="v" class="wp-ai-diff__chip" data-change="removed">${{ v }}</code></template>
    </p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-textdiff { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-textdiff__rows { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 0; }
.wp-ai-textdiff__rows dt { color: var(--wp-text-muted); }
.wp-ai-textdiff__rows dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-ai-textdiff__part[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 22%, transparent); border-radius: min(3px, var(--wp-radius-cap, 999px)); }
.wp-ai-textdiff__part[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 16%, transparent); border-radius: min(3px, var(--wp-radius-cap, 999px)); text-decoration: line-through; text-decoration-color: var(--wp-danger, #e5484d); opacity: 0.85; }
.wp-ai-textdiff__reads { margin: 0; font-size: 11.5px; color: var(--wp-text-muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.wp-ai-textdiff__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 6; line-clamp: 6; overflow: hidden; }
</style>
