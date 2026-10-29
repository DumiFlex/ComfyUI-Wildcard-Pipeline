<script setup lang="ts">
import CodeBlock from "@/kit/CodeBlock.vue";

const json = `{
  "type": "wildcard",
  "name": "Hair colour",
  "options": [
    { "value": "auburn hair", "weight": 1, "tags": ["warm"] },
    { "value": "silver hair with a long fringe that falls over one eye and catches the rim light", "weight": 0.5 }
  ]
}`;
const log = "POST /wp/api/ai/chat 200 1.8 s\nmodel qwen3.5-9b · 3,412 tokens in · 286 out\n\ntool search_library {\"query\": \"hair\"}\ntool test_stack {\"seeds\": 200}";
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <CodeBlock :code="json" language="JSON" title="Export" max-height="180px" />
    <CodeBlock :code="log" title="Request" line-numbers wrap />
    <div class="wp-kit__canvas">
      <p class="wp-kit__caption">Canvas, size sm, bare</p>
      <CodeBlock code="masterpiece, 1girl, auburn hair, rim light" size="sm" bare />
    </div>
  </div>
</template>
