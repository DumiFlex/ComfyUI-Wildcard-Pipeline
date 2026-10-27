<script setup lang="ts">
/**
 * AiBulkView — one change to many items, one row per item: its name, then
 * what changes on it (category chip → chip, rating, tags), the way
 * `AiInfoDiff` draws one item. Capped in the chat; the magnifier lists all.
 */
import { computed } from "vue";
import type { CardView } from "../../../composables/card-views/types";
import AiInfoDiff from "./AiInfoDiff.vue";

type View = Extract<CardView, { kind: "bulk" }>;
const props = defineProps<{ view: View; full?: boolean }>();

const CAP = 6;
const ICONS: Record<string, string> = { bundle: "pi pi-box", template: "pi pi-file-edit" };
const shown = computed(() => (props.full ? props.view.rows : props.view.rows.slice(0, CAP)));
const more = computed(() => (props.full ? 0 : Math.max(0, props.view.rows.length - CAP)));
</script>

<template>
  <div class="wp-ai-bulk" data-test="ai-card-bulk">
    <section v-for="(r, i) in shown" :key="i" class="wp-ai-bulk__item">
      <span class="wp-ai-bulk__name"><i v-if="ICONS[r.itemKind]" :class="ICONS[r.itemKind]" aria-hidden="true" /> {{ r.name }}</span>
      <AiInfoDiff :rows="r.changes" :full="full" />
    </section>
    <p v-if="more" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more }} more item{{ more === 1 ? "" : "s" }}</p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-bulk { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-bulk__item { display: flex; flex-direction: column; gap: 2px; }
.wp-ai-bulk__item + .wp-ai-bulk__item { border-top: 1px solid var(--wp-border); padding-top: 6px; }
.wp-ai-bulk__name { font-weight: 600; font-size: 12.5px; }
</style>
