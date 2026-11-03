<script setup lang="ts">
/**
 * DocFields — one group of a node's field list (`docs/node-fields.ts`), drawn
 * as a DocKeyList. The same list feeds the node's native help page, so the
 * docs page and ComfyUI's Node Info panel can't drift apart.
 */
import { computed } from "vue";
import DocKeyList from "./DocKeyList.vue";
import { fieldsOf, type FieldNodeId } from "../../docs/node-fields";

const props = defineProps<{ node: FieldNodeId; group: string }>();
const items = computed(() => fieldsOf(props.node, props.group));
</script>

<template>
  <DocKeyList :items="items" />
</template>
