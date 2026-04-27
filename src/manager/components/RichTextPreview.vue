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

/* Token span chrome (chip backgrounds, var/ref colours, padding) lives in
   the global styles/rich-text.css so RichTextInput and this preview stay
   visually identical without duplicating rules. */
</style>
