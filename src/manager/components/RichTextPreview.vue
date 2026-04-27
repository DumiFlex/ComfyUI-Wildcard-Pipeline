<script setup lang="ts">
/**
 * RichTextPreview
 *
 * Read-only counterpart to {@link RichTextInput}. Renders the same
 * mirror HTML produced by the shared `tokenizeRich` + `mirrorHtmlWithIdx`
 * helpers, without any textarea or autocomplete chrome. Used in list-row
 * expansions and any other place we want to show wildcard syntax with
 * styled chips at rest.
 */
import { computed } from "vue";
import { tokenizeRich, mirrorHtmlWithIdx } from "../utils/richTokenize";

interface Props {
  value: string;
}

const props = defineProps<Props>();

const tokens = computed(() => tokenizeRich(props.value || ""));
// SAFE: `mirrorHtmlWithIdx` HTML-escapes every `raw` payload before
// concatenation. The resulting string only contains tags we generated, so
// `v-html` cannot inject user-controlled markup.
const html = computed(() => mirrorHtmlWithIdx(tokens.value));
</script>

<template>
  <span class="wp-rt-preview wp-rt--rest" v-html="html" />
</template>

<style scoped>
.wp-rt-preview {
  display: inline;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Mirror the chip chrome used by RichTextInput at rest. Kept duplicated
   (rather than imported) so the preview can stand alone in pages that don't
   mount the input component. */
.wp-rt-preview :deep(.wp-rt-text)     { color: var(--wp-text, #e7e7ee); }
.wp-rt-preview :deep(.wp-rt-comment)  { color: var(--wp-text-dim, #6e6e7c); font-style: italic; }
.wp-rt-preview :deep(.wp-rt-escape)   { color: var(--wp-text-muted, #a1a1ad); opacity: 0.7; }
.wp-rt-preview :deep(.wp-rt-tail)     { color: transparent; }

.wp-rt-preview :deep(.wp-rt-var) {
  color: var(--wp-accent-text-strong, var(--wp-accent-text, #c4b5fd));
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 15%, transparent);
  padding: 0 4px;
  border-radius: 4px;
  font-weight: 500;
}
.wp-rt-preview :deep(.wp-rt-ref) {
  color: var(--wp-kind-wildcard, #f0abfc);
  background: color-mix(in oklab, var(--wp-kind-wildcard, #c026d3) 12%, transparent);
  padding: 0 4px;
  border-radius: 4px;
  font-weight: 500;
}
.wp-rt-preview :deep(.wp-rt-dp-brace) { color: var(--wp-warn, #fcd34d); font-weight: 600; }
.wp-rt-preview :deep(.wp-rt-dp-pipe)  { color: var(--wp-warn, #fcd34d); opacity: 0.65; }
.wp-rt-preview :deep(.wp-rt-dp-multi) {
  color: #34d399;
  background: color-mix(in oklab, #10b981 12%, transparent);
  padding: 0 3px;
  border-radius: 3px;
  font-weight: 500;
}
.wp-rt-preview :deep(.wp-rt-dp-weight) {
  color: #fb923c;
  background: color-mix(in oklab, #f97316 12%, transparent);
  padding: 0 3px;
  border-radius: 3px;
  font-weight: 500;
}
.wp-rt-preview :deep(.wp-rt-quantifier) {
  color: var(--wp-info, #60a5fa);
  background: color-mix(in oklab, var(--wp-info, #3b82f6) 14%, transparent);
  padding: 0 3px;
  border-radius: 3px;
  font-weight: 500;
}
</style>
