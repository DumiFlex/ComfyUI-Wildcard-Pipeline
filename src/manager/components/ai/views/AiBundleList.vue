<script setup lang="ts">
/**
 * AiBundleList — a bundle edit as its ordered list of items, like the
 * bundle editor's rows: kind icon, place, name and use settings. Each row
 * is marked + added, − removed (struck), ↕ moved (from its old place),
 * on → off, or its use old → new. Items the edit leaves in place fold
 * into a count; the magnifier lists them dimmed.
 */
import { computed } from "vue";
import type { BundleRowView, CardView } from "../../../composables/card-views/types";
import { kindIcon } from "../../../../components/shared/kind-icons";

type View = Extract<CardView, { kind: "bundle" }>;
const props = defineProps<{ view: View; full?: boolean }>();

const CAP = 10;
const MARK: Record<string, string> = { added: "+", removed: "−", changed: "~", moved: "↕", same: "" };
const LABEL: Record<string, string> = { added: "Added", removed: "Removed", changed: "Changed", moved: "Moved", same: "Unchanged" };

const changed = computed(() => props.view.rows.filter((r) => r.change !== "same"));
const shown = computed<BundleRowView[]>(() => (props.full ? props.view.rows : changed.value.slice(0, CAP)));
const more = computed(() => (props.full ? 0 : Math.max(0, changed.value.length - CAP)));

function icon(r: BundleRowView): string {
  return r.type === "bundle" ? "pi pi-box" : kindIcon(r.type);
}
</script>

<template>
  <div class="wp-ai-bundle" data-test="ai-card-bundle">
    <p class="wp-ai-bundle__head">
      <span>{{ view.before }} → {{ view.after }} item{{ view.after === 1 ? "" : "s" }}</span>
      <span v-if="view.same && !full" data-test="ai-card-unchanged"> · {{ view.same }} unchanged</span>
    </p>
    <ol class="wp-ai-bundle__rows">
      <li v-for="(r, i) in shown" :key="i" :data-change="r.change" data-test="ai-card-bundle-row">
        <span class="wp-ai-diff__mark" aria-hidden="true">{{ MARK[r.change] }}</span><span class="wp-ai-diff__sr">{{ LABEL[r.change] }}: </span>
        <span class="wp-ai-bundle__at wp-mono">{{ r.at }}</span>
        <i :class="icon(r)" class="wp-ai-bundle__icon" aria-hidden="true" />
        <span class="wp-ai-bundle__body">
          <span class="wp-ai-bundle__name" :class="{ 'wp-ai-diff__was': r.change === 'removed' }">{{ r.name }}</span>
          <span v-if="r.wasAt !== null" class="wp-ai-bundle__note">moved from {{ r.wasAt }}</span>
          <span v-if="r.wasEnabled !== null" class="wp-ai-bundle__note"><span class="wp-ai-diff__was">{{ r.wasEnabled ? "on" : "off" }}</span><span class="wp-ai-diff__arrow">→</span>{{ r.enabled ? "on" : "off" }}</span>
          <span v-else-if="!r.enabled" class="wp-ai-bundle__note">off</span>
          <span v-if="r.use || r.wasUse" class="wp-ai-bundle__use">
            <template v-if="r.wasUse !== null"><span class="wp-ai-diff__was">{{ r.wasUse || "default use" }}</span><span class="wp-ai-diff__arrow">→</span></template>{{ r.use || "default use" }}
          </span>
        </span>
      </li>
    </ol>
    <p v-if="more" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more }} more change{{ more === 1 ? "" : "s" }}</p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-bundle { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-bundle__head { margin: 0; font-size: 11.5px; color: var(--wp-text-muted); }
.wp-ai-bundle__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.wp-ai-bundle__rows > li { display: flex; gap: 6px; align-items: baseline; padding: 2px 6px 2px 2px; border-radius: min(4px, var(--wp-radius-cap, 999px)); }
.wp-ai-bundle__rows > li[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 9%, transparent); }
.wp-ai-bundle__rows > li[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 8%, transparent); }
[data-change="moved"] > .wp-ai-diff__mark { color: var(--wp-accent-400, var(--wp-accent-500)); }
.wp-ai-bundle__at { min-width: 1.4em; text-align: right; font-size: 11.5px; color: var(--wp-text-muted); }
.wp-ai-bundle__icon { font-size: 11px; color: var(--wp-text-muted); }
.wp-ai-bundle__body { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; }
.wp-ai-bundle__name { font-weight: 500; overflow-wrap: anywhere; }
.wp-ai-bundle__note { font-size: 11.5px; color: var(--wp-text-muted); }
.wp-ai-bundle__use { flex-basis: 100%; font-size: 11.5px; color: var(--wp-text-muted); font-family: var(--wp-font-mono, ui-monospace, monospace); }
</style>
