<script setup lang="ts">
/**
 * AiTagView — tag renames and merges as `#old → #new`, with how many
 * items each touches, and a merge said out loud: the old tag's items join
 * a tag that already exists.
 */
import type { CardView } from "../../../composables/card-views/types";

type View = Extract<CardView, { kind: "tags" }>;
defineProps<{ view: View }>();
</script>

<template>
  <ul class="wp-ai-tagview" data-test="ai-card-tags">
    <li v-for="r in view.rows" :key="r.from">
      <span class="wp-ai-diff__chip" data-change="removed">#{{ r.from }}</span>
      <span class="wp-ai-diff__arrow" aria-label="becomes">→</span>
      <span class="wp-ai-diff__chip" :data-change="r.merge ? undefined : 'added'">#{{ r.to }}</span>
      <span class="wp-ai-tagview__note">
        {{ r.merge ? "merges into the existing tag · " : "" }}{{ r.count }} item{{ r.count === 1 ? "" : "s" }}
      </span>
    </li>
  </ul>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-tagview { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wp-ai-tagview li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.wp-ai-tagview__note { margin-left: 6px; font-size: 11.5px; color: var(--wp-text-muted); }
</style>
