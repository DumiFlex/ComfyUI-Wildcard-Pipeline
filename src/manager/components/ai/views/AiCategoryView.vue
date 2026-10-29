<script setup lang="ts">
/**
 * AiCategoryView — a categories card drawn with the library's own chips:
 * new categories in their colour and icon, renames and new colours or
 * icons as old chip → new chip.
 */
import type { CardView } from "../../../composables/card-views/types";
import Chip from "../../../../kit/Chip.vue";

type View = Extract<CardView, { kind: "categories" }>;
defineProps<{ view: View }>();
</script>

<template>
  <div class="wp-ai-cats" data-test="ai-card-categories">
    <div v-if="view.create.length" class="wp-ai-cats__group">
      <span class="wp-ai-cats__label">New</span>
      <span class="wp-ai-cats__chips">
        <span v-for="c in view.create" :key="c.name" data-change="added" class="wp-ai-cats__item">
          <span class="wp-ai-diff__mark" aria-hidden="true">+</span>
          <Chip :color="c.color" :icon="c.icon">{{ c.name }}</Chip>
        </span>
      </span>
    </div>
    <div v-if="view.rename.length" class="wp-ai-cats__group">
      <span class="wp-ai-cats__label">Rename</span>
      <ul class="wp-ai-cats__rows">
        <li v-for="r in view.rename" :key="r.from.name">
          <Chip :color="r.from.color" :icon="r.from.icon" class="wp-ai-cats__was">{{ r.from.name }}</Chip>
          <span class="wp-ai-diff__arrow" aria-label="becomes">→</span>
          <Chip :color="r.to.color" :icon="r.to.icon">{{ r.to.name }}</Chip>
        </li>
      </ul>
    </div>
    <div v-if="view.restyle.length" class="wp-ai-cats__group">
      <span class="wp-ai-cats__label">Colour and icon</span>
      <ul class="wp-ai-cats__rows">
        <li v-for="r in view.restyle" :key="r.from.name">
          <Chip :color="r.from.color" :icon="r.from.icon" class="wp-ai-cats__was">{{ r.from.name }}</Chip>
          <span class="wp-ai-diff__arrow" aria-label="becomes">→</span>
          <Chip :color="r.to.color" :icon="r.to.icon">{{ r.to.name }}</Chip>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-cats { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-cats__group { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: 4px 8px; align-items: baseline; }
.wp-ai-cats__label { color: var(--wp-text-muted); font-size: 12px; }
.wp-ai-cats__chips { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.wp-ai-cats__item { display: inline-flex; align-items: center; gap: 2px; }
.wp-ai-cats__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wp-ai-cats__rows li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.wp-ai-cats__was { opacity: 0.6; }
</style>
