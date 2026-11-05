<script setup lang="ts">
/**
 * DocFigureText — the written description of a docs figure, visually
 * hidden. Screen readers read it, and the AI chat's docs index (which
 * leaves figures out) carries it, so the chat can explain a screenshot or
 * diagram without seeing it. Text lives in `docs/figures.ts`.
 */
import { computed } from "vue";
import { figureText } from "../../docs/figures";

const props = defineProps<{
  /** Key in `FIGURE_TEXT`: the image path or the figure id. */
  figure?: string;
  caption?: string;
  /** A flow diagram's steps in words ("A → label → B"). */
  flow?: string;
}>();

const described = computed(() => figureText(props.figure));
const text = computed(() => {
  const cap = props.caption?.trim();
  return [cap ? `Figure: ${/[.!?]$/.test(cap) ? cap : `${cap}.`}` : "Figure:",
    props.flow ? `Steps: ${props.flow}.` : "", described.value].filter(Boolean).join(" ");
});
</script>

<template>
  <p v-if="described || flow" class="wp-doc-figtext" data-test="doc-figure-text">{{ text }}</p>
</template>

<style scoped>
.wp-doc-figtext {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
