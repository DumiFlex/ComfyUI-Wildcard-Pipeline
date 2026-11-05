<script setup lang="ts">
/**
 * AiSyntax — a run of text with its prompt syntax coloured
 * (`utils/chat-syntax.ts`): the same colours in a reply, on a card's
 * options, in a rule's test or a fixed value, and in the card magnifier.
 * Renders inline, so it drops into any line.
 */
import { h } from "vue";
import { syntaxNodes } from "../../utils/chat-syntax";

const props = defineProps<{ text: string }>();
const Run = () => h("span", { class: "wp-ai-syn" }, syntaxNodes(props.text));
</script>

<template>
  <Run />
</template>

