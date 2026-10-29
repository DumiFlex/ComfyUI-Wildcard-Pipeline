<script setup lang="ts">
/**
 * AiInfoDiff — an item's own fields old → new (name, description, tags,
 * category, rating), the way the library shows them: the category as its
 * chip, tags as chips with the dropped ones struck and the added ones
 * green, text as old struck → new.
 */
import type { InfoRowView } from "../../../composables/card-views/types";
import Chip from "../../../../kit/Chip.vue";
import AiSyntax from "../AiSyntax.vue";

defineProps<{ rows: InfoRowView[]; full?: boolean }>();
</script>

<template>
  <dl class="wp-ai-info" data-test="ai-card-info">
    <template v-for="r in rows" :key="r.label">
      <dt>{{ r.label }}</dt>
      <dd :data-field="r.field">
        <template v-if="r.field === 'text'">
          <span v-if="r.from" class="wp-ai-diff__was" :class="{ 'wp-ai-info__clamp': !full }"><AiSyntax :text="r.from" /></span>
          <span v-else class="wp-ai-diff__none">none</span>
          <span class="wp-ai-diff__arrow" aria-label="becomes">→</span>
          <span v-if="r.to" :class="{ 'wp-ai-info__clamp': !full }"><AiSyntax :text="r.to" /></span>
          <span v-else class="wp-ai-diff__none">none</span>
        </template>
        <template v-else-if="r.field === 'tags'">
          <span v-for="t in r.tags" :key="t.tag" class="wp-ai-diff__chip" :data-change="t.change" :title="t.change === 'removed' ? 'Taken off' : t.change === 'added' ? 'Added' : undefined">#{{ t.tag }}</span>
        </template>
        <template v-else-if="r.field === 'category'">
          <Chip v-if="r.from" :color="r.from.color" :icon="r.from.icon" class="wp-ai-info__was-chip">{{ r.from.name }}</Chip>
          <span v-else class="wp-ai-diff__none">none</span>
          <span class="wp-ai-diff__arrow" aria-label="becomes">→</span>
          <template v-if="r.to">
            <Chip :color="r.to.color" :icon="r.to.icon" data-test="ai-card-category-to">{{ r.to.name }}</Chip>
            <span v-if="r.to.isNew" class="wp-ai-diff__new">new</span>
          </template>
          <span v-else class="wp-ai-diff__none">none</span>
        </template>
        <template v-else>
          <span class="wp-ai-info__rating wp-ai-info__was-chip" :data-rating="r.from">{{ r.from }}</span>
          <span class="wp-ai-diff__arrow" aria-label="becomes">→</span>
          <span class="wp-ai-info__rating" :data-rating="r.to">{{ r.to }}</span>
        </template>
      </dd>
    </template>
  </dl>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-info { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 0; }
.wp-ai-info dt { color: var(--wp-text-muted); }
.wp-ai-info dd { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.wp-ai-info__was-chip { opacity: 0.6; }
.wp-ai-info__rating { font-size: 11px; padding: 0 6px; border-radius: min(4px, var(--wp-radius-cap, 999px)); border: 1px solid var(--wp-border); color: var(--wp-text-muted); }
.wp-ai-info__rating[data-rating="NSFW"] { color: var(--wp-danger, #e5484d); border-color: color-mix(in oklab, var(--wp-danger, #e5484d) 45%, transparent); }
.wp-ai-info__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
</style>
