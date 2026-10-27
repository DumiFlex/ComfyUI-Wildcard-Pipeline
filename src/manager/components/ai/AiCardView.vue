<script setup lang="ts">
/**
 * AiCardView — what a chat card makes or changes, laid out the way its
 * editor shows it (one view from `composables/card-views`), prompt syntax
 * coloured (`AiSyntax`). The views in `views/` draw a new item and a
 * change to one (old → new): a constraint's grid, a derivation's
 * IF / ELIF / ELSE blocks, a bundle's list, an item's fields, a wildcard's
 * options, categories, tags and bulk changes. Fixed values (a table) and a
 * combine or template (its text) are drawn here. Read-only; "Open in
 * editor" is where it gets changed.
 *
 * In the chat it stays small: the grid, rules, rows and text are capped
 * (with "+N more") and the card's magnifier shows it `full` in a modal.
 */
import type { CardView } from "../../composables/card-views/types";
import AiSyntax from "./AiSyntax.vue";
import AiBulkView from "./views/AiBulkView.vue";
import AiBundleList from "./views/AiBundleList.vue";
import AiCategoryView from "./views/AiCategoryView.vue";
import AiConstraintGrid from "./views/AiConstraintGrid.vue";
import AiDerivationBlocks from "./views/AiDerivationBlocks.vue";
import AiInfoDiff from "./views/AiInfoDiff.vue";
import AiOptionDiff from "./views/AiOptionDiff.vue";
import AiTagView from "./views/AiTagView.vue";

const props = defineProps<{ view: CardView; full?: boolean }>();

/** What the chat card shows before "+N more" (the preview shows all). */
const CAP = { rows: 8 };

function cap<T>(list: T[], n: number): T[] {
  return props.full ? list : list.slice(0, n);
}

function more(list: unknown[], n: number): number {
  return props.full ? 0 : Math.max(0, list.length - n);
}
</script>

<template>
  <div class="wp-ai-card-view" :data-kind="view.kind" data-test="ai-card-view">
    <AiConstraintGrid v-if="view.kind === 'constraint'" :view="view" :full="full" />
    <AiDerivationBlocks v-else-if="view.kind === 'derivation'" :view="view" :full="full" />
    <AiBundleList v-else-if="view.kind === 'bundle'" :view="view" :full="full" />

    <template v-else-if="view.kind === 'values'">
      <table class="wp-ai-card-view__table">
        <tbody>
          <tr v-for="r in cap(view.rows, CAP.rows)" :key="r.name">
            <td><code>${{ r.name }}</code></td>
            <td :class="{ 'wp-ai-card-view__clamp': !full }"><AiSyntax :text="r.value" /><span v-if="r.negative" class="wp-ai-card-view__neg"> − <AiSyntax :text="r.negative" /></span></td>
          </tr>
        </tbody>
      </table>
      <p v-if="more(view.rows, CAP.rows)" class="wp-ai-card-view__more" data-test="ai-card-more">+{{ more(view.rows, CAP.rows) }} more value{{ more(view.rows, CAP.rows) === 1 ? "" : "s" }}</p>
    </template>

    <AiInfoDiff v-else-if="view.kind === 'info'" :rows="view.rows" :full="full" />
    <AiOptionDiff v-else-if="view.kind === 'options'" :view="view" :full="full" />
    <AiCategoryView v-else-if="view.kind === 'categories'" :view="view" />
    <AiTagView v-else-if="view.kind === 'tags'" :view="view" />
    <AiBulkView v-else-if="view.kind === 'bulk'" :view="view" :full="full" />

    <dl v-else-if="view.kind === 'text'" class="wp-ai-card-view__text">
      <template v-for="r in view.rows" :key="r.label">
        <dt>{{ r.label }}</dt>
        <dd :class="{ 'wp-ai-card-view__clamp wp-ai-card-view__clamp--6': !full }"><AiSyntax :text="r.text" /></dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
.wp-ai-card-view { font-size: 12.5px; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 6px; background: var(--wp-bg-sunken, var(--wp-bg)); }
.wp-ai-card-view__table { border-collapse: collapse; width: 100%; }
.wp-ai-card-view__table td { padding: 2px 6px 2px 0; vertical-align: top; overflow-wrap: anywhere; }
.wp-ai-card-view__neg { color: var(--wp-text-muted); }
.wp-ai-card-view__text { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 0; }
.wp-ai-card-view__text dt { color: var(--wp-text-muted); }
.wp-ai-card-view__text dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-ai-card-view__more { margin: 0; font-size: 11.5px; color: var(--wp-text-muted); }
/* Long values: a few lines in the chat; the preview shows them whole. */
.wp-ai-card-view__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.wp-ai-card-view__clamp--6 { -webkit-line-clamp: 6; line-clamp: 6; }
</style>
