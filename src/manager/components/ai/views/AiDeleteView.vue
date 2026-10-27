<script setup lang="ts">
/**
 * AiDeleteView — what a delete card removes, as the library lists it:
 * each item with its kind icon, category chip and rating, each category
 * as its chip with how many items it holds, each tag with its item count.
 * Undo makes them again at their ids.
 */
import { computed } from "vue";
import type { CardView } from "../../../composables/card-views/types";
import { kindIcon } from "../../../../components/shared/kind-icons";
import Chip from "../../ui/Chip.vue";

type View = Extract<CardView, { kind: "delete" }>;
const props = defineProps<{ view: View; full?: boolean }>();

const CAP = 8;
const shown = computed(() => (props.full ? props.view.items : props.view.items.slice(0, CAP)));
const more = computed(() => (props.full ? 0 : Math.max(0, props.view.items.length - CAP)));
const icon = (type: string) => (type === "bundle" ? "pi pi-box" : kindIcon(type));
</script>

<template>
  <div class="wp-ai-delete" data-test="ai-card-delete">
    <ul v-if="view.items.length" class="wp-ai-delete__rows">
      <li v-for="(it, i) in shown" :key="i" data-change="removed" data-test="ai-card-delete-item">
        <span class="wp-ai-diff__mark" aria-hidden="true">−</span>
        <i :class="icon(it.type)" class="wp-ai-delete__icon" aria-hidden="true" />
        <span class="wp-ai-delete__name">{{ it.name }}</span>
        <span class="wp-ai-delete__type">{{ it.type.replace("_", " ") }}</span>
        <Chip v-if="it.category" :color="it.category.color" :icon="it.category.icon">{{ it.category.name }}</Chip>
        <span v-if="it.rating" class="wp-ai-delete__rating">{{ it.rating }}</span>
      </li>
    </ul>
    <p v-if="more" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more }} more item{{ more === 1 ? "" : "s" }}</p>
    <div v-if="view.categories.length" class="wp-ai-delete__group">
      <span class="wp-ai-delete__label">Categories</span>
      <span v-for="c in view.categories" :key="c.name" class="wp-ai-delete__cat">
        <Chip :color="c.color" :icon="c.icon" class="wp-ai-delete__struck">{{ c.name }}</Chip>
        <span class="wp-ai-delete__count">{{ c.count ? `${c.count} item${c.count === 1 ? "" : "s"} keep no category` : "empty" }}</span>
      </span>
    </div>
    <div v-if="view.tags.length" class="wp-ai-delete__group">
      <span class="wp-ai-delete__label">Tags</span>
      <span v-for="t in view.tags" :key="t.tag" class="wp-ai-delete__cat">
        <span class="wp-ai-diff__chip" data-change="removed">#{{ t.tag }}</span>
        <span class="wp-ai-delete__count">off {{ t.count }} item{{ t.count === 1 ? "" : "s" }}</span>
      </span>
    </div>
    <p class="wp-ai-diff__more">Undo makes them again as they were.</p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-delete { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-delete__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.wp-ai-delete__rows li { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 2px 6px 2px 2px; border-radius: 4px; background: color-mix(in oklab, var(--wp-danger, #e5484d) 7%, transparent); }
.wp-ai-delete__icon { font-size: 11px; color: var(--wp-text-muted); }
.wp-ai-delete__name { font-weight: 500; text-decoration: line-through; text-decoration-color: color-mix(in oklab, var(--wp-danger, #e5484d) 70%, transparent); }
.wp-ai-delete__type { font-size: 11px; color: var(--wp-text-muted); }
.wp-ai-delete__rating { font-size: 11px; padding: 0 6px; border-radius: 4px; color: var(--wp-danger, #e5484d); border: 1px solid color-mix(in oklab, var(--wp-danger, #e5484d) 45%, transparent); }
.wp-ai-delete__group { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.wp-ai-delete__label { color: var(--wp-text-muted); font-size: 12px; min-width: 6.5em; }
.wp-ai-delete__cat { display: inline-flex; gap: 4px; align-items: center; }
.wp-ai-delete__struck { text-decoration: line-through; }
.wp-ai-delete__count { font-size: 11.5px; color: var(--wp-text-muted); }
</style>
