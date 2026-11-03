<script setup lang="ts">
/**
 * RemapRefPopup — heals a broken nested `@{uuid}` chip (#3). A kit Popover
 * hanging from the broken chip (`anchor`, a virtual anchor RichTextInput
 * builds, like the SubcategoryFilterPicker's). A press outside or Escape
 * cancels. The user:
 *   1. Picks a replacement wildcard from a searchable dropdown (seeded with
 *      the broken ref's cached `#name` so the likely match floats up).
 *   2. If the broken ref carried a `:subcat` filter, reconciles it against
 *      the PICKED wildcard's sub_categories — surviving tokens stay, unknown
 *      tokens render struck-through with an "N dropped" note.
 *
 * RECONCILE IS DESTRUCTIVE. The dropped set is previewed BEFORE confirm so
 * the decision is informed; CONFIRM is the point of no return (the caller
 * rewrites the open module's payload); CANCEL is the only undo. There is no
 * post-confirm undo of dropped tokens in v1 (spec "Reconcile loss").
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import Popover from "@/kit/Popover.vue";
import type { VirtualAnchor } from "@/kit/floating";
import SearchInput from "@/kit/SearchInput.vue";
import SubcategoryFilterPicker from "./SubcategoryFilterPicker.vue";
import { reconcileSubcatExpr } from "../cascade/reconcile-subcat";
import type { WildcardRefData } from "../utils/library-suggestions";

const props = defineProps<{
  oldUuid: string;
  cachedName: string;
  refData: WildcardRefData;
  oldExpr: string;
  oldExcludeNull: boolean;
  /** What the popup hangs from: the broken chip. */
  anchor: VirtualAnchor | null;
}>();

const emit = defineEmits<{
  confirm: [next: { uuid: string; name: string; subcatExpr: string; excludeNull: boolean }];
  cancel: [];
}>();

const query = ref(props.cachedName);
const pickedUuid = ref<string | null>(null);

watch(() => props.cachedName, (n) => { query.value = n; });

interface Candidate { uuid: string; name: string; count: number }

const candidates = computed<Candidate[]>(() => {
  const q = query.value.trim().toLowerCase();
  const out: Candidate[] = [];
  for (const [uuid, name] of props.refData.uuidToName) {
    if (uuid === props.oldUuid) continue; // can't pick the still-dangling uuid
    // Match name OR uuid — picking a remap target by its 8-hex id is the
    // reliable path when two wildcards share a display name.
    if (q && !name.toLowerCase().includes(q) && !uuid.toLowerCase().includes(q)) continue;
    out.push({ uuid, name, count: props.refData.uuidToOptionsCount.get(uuid) ?? 0 });
  }
  // Exact cached-name match floats to top, then alpha.
  const cached = props.cachedName.trim().toLowerCase();
  return out.sort((a, b) => {
    const ax = a.name.toLowerCase() === cached ? 0 : 1;
    const bx = b.name.toLowerCase() === cached ? 0 : 1;
    return ax !== bx ? ax - bx : a.name.localeCompare(b.name);
  });
});

const pickedName = computed(() =>
  pickedUuid.value ? props.refData.uuidToName.get(pickedUuid.value) ?? "" : "",
);
const pickedSubs = computed(() =>
  pickedUuid.value ? props.refData.uuidToSubCategories.get(pickedUuid.value) ?? [] : [],
);
const pickedHasNull = computed(() =>
  pickedUuid.value ? props.refData.uuidToHasNull.get(pickedUuid.value) ?? false : false,
);
const pickedTagGroups = computed(() =>
  pickedUuid.value ? props.refData.uuidToTagGroups.get(pickedUuid.value) ?? {} : {},
);
const pickedOptionTagSets = computed(() =>
  pickedUuid.value ? props.refData.uuidToOptionTagSets.get(pickedUuid.value) ?? [] : [],
);

const hadFilter = computed(() => props.oldExpr.trim().length > 0 || props.oldExcludeNull);

// Live reconcile of the OLD expr against the PICKED wildcard's sub_categories.
const reconciled = computed(() => reconcileSubcatExpr(props.oldExpr, pickedSubs.value));

// Live edit buffer: the picker can refine the surviving expression before
// confirm. Seeded from the reconciled survivors when a wildcard is picked.
const liveExpr = ref("");
const liveExcludeNull = ref(false);
watch(pickedUuid, () => {
  liveExpr.value = reconciled.value.survivingExpr;
  liveExcludeNull.value = props.oldExcludeNull; // null is universal — carries as-is
});

// The popup GROWS when a wildcard is picked (the reconcile section and the
// filter picker mount), so it is placed again on every size change: one that
// fit below the chip at open can overflow the viewport after a pick.
const pop = ref<{ place: () => void } | null>(null);
let sizeObs: ResizeObserver | null = null;
function watchSize(el: Element | null): void {
  sizeObs?.disconnect();
  sizeObs = null;
  // jsdom has no ResizeObserver; the Popover still places once on open.
  if (!el || typeof ResizeObserver === "undefined") return;
  sizeObs = new ResizeObserver(() => pop.value?.place());
  sizeObs.observe(el);
}
onBeforeUnmount(() => sizeObs?.disconnect());

function pick(uuid: string): void {
  pickedUuid.value = uuid;
}

function onPickerApply(filter: { expr: string; excludeNull: boolean }): void {
  liveExpr.value = filter.expr;
  liveExcludeNull.value = filter.excludeNull;
  doConfirm();
}

function doConfirm(): void {
  if (!pickedUuid.value) return;
  emit("confirm", {
    uuid: pickedUuid.value,
    name: pickedName.value,
    subcatExpr: liveExpr.value.trim(),
    excludeNull: liveExcludeNull.value,
  });
}
</script>

<template>
  <Popover
    ref="pop"
    :open="true"
    :anchor="anchor"
    label="Remap broken reference"
    class="wp-remap-pop"
    data-test="remap-popup"
    @update:open="(v: boolean) => { if (!v) emit('cancel'); }"
  >
    <div :ref="(el) => watchSize(el as Element | null)" class="wpc-remap">
      <div class="wpc-remap__head">Remap broken reference</div>

      <SearchInput
        v-model="query"
        size="sm"
        class="wpc-remap__search"
        data-test="remap-search"
        aria-label="Search wildcards"
        placeholder="Search wildcards…"
        spellcheck="false"
        autocomplete="off"
      />

      <ul class="wpc-remap__list">
        <li
          v-for="c in candidates"
          :key="c.uuid"
          class="wpc-remap__candidate"
          data-test="remap-candidate"
          :data-test-id="`remap-candidate-${c.uuid}`"
          :class="{ 'wpc-remap__candidate--picked': c.uuid === pickedUuid }"
          @click="pick(c.uuid)"
        >
          <span class="wpc-remap__cand-name">{{ c.name }}</span>
          <span class="wpc-remap__cand-meta"><code class="wpc-remap__cand-uuid" data-test="remap-cand-uuid">{{ c.uuid }}</code> · {{ c.count }} opts</span>
        </li>
      </ul>

      <!-- Reconcile preview — only when the old ref carried a filter and a
           wildcard is picked. Surviving expr is editable via the picker;
           dropped tokens are struck through (point of no return on confirm). -->
      <div v-if="pickedUuid && hadFilter" class="wpc-remap__reconcile">
        <p
          v-if="reconciled.dropped.length > 0"
          class="wpc-remap__dropped"
          data-test="remap-dropped"
        >
          <span class="wpc-remap__dropped-count">{{ reconciled.dropped.length }} dropped</span>
          — not in <code>{{ pickedName }}</code>:
          <span
            v-for="d in reconciled.dropped"
            :key="d"
            class="wpc-remap__dropped-tok"
          >{{ d }}</span>
        </p>
        <SubcategoryFilterPicker
          :sub-categories="pickedSubs"
          :tag-groups="pickedTagGroups"
          :option-tag-sets="pickedOptionTagSets"
          :initial-expr="liveExpr"
          :initial-exclude-null="liveExcludeNull"
          :has-null-option="pickedHasNull"
          mode="edit"
          @apply="onPickerApply"
          @skip="doConfirm"
          @delete="emit('cancel')"
        />
      </div>

      <div class="wpc-remap__actions">
        <span class="wpc-remap__note">Cancel is the only undo — confirm is final.</span>
        <Button size="sm" data-test="remap-cancel" @click="emit('cancel')">Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          data-test="remap-confirm"
          :disabled="!pickedUuid"
          @click="doConfirm"
        >Remap</Button>
      </div>
    </div>
  </Popover>
</template>

<style scoped>
.wpc-remap {
  min-width: 320px;
  font: 12px var(--wp-font-sans, sans-serif);
  color: var(--wp-text);
}
.wpc-remap__head {
  font: 600 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim);
  margin-bottom: 8px;
}
.wpc-remap__search { width: 100%; }
.wpc-remap__list {
  list-style: none;
  margin: 8px 0;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
}
.wpc-remap__candidate {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  cursor: pointer;
}
.wpc-remap__candidate:hover { background: color-mix(in oklab, var(--wp-accent) 18%, transparent); }
.wpc-remap__candidate--picked { background: color-mix(in oklab, var(--wp-accent) 28%, transparent); }
.wpc-remap__cand-meta { font: 10px var(--wp-font-mono); color: var(--wp-text-dim); }
.wpc-remap__cand-uuid { font: inherit; color: var(--wp-text-muted, var(--wp-text-dim)); }
.wpc-remap__reconcile {
  border-top: 1px dashed var(--wp-border, rgba(255,255,255,0.12));
  padding-top: 8px;
  margin-top: 4px;
}
.wpc-remap__dropped {
  margin: 0 0 8px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted);
}
.wpc-remap__dropped-count { color: var(--wp-danger); font-weight: 600; }
.wpc-remap__dropped-tok {
  text-decoration: line-through;
  opacity: 0.7;
  margin-left: 5px;
  font-family: var(--wp-font-mono, monospace);
}
.wpc-remap__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.wpc-remap__note {
  flex: 1;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim);
}
</style>

<style>
/* The Popover panel is the card (not scoped: the panel lives under <body>,
   outside this component's root). It caps itself at the room beside the chip
   and scrolls past that; the observer above re-places it as it grows. */
.wp-popover.wp-remap-pop {
  z-index: 10021;
  max-width: 480px;
  padding: 13px 15px; /* plus the 1px ring */
  background: var(--wp-bg-2);
  box-shadow: inset 0 0 0 1px var(--wp-accent), 0 4px 12px rgba(0, 0, 0, 0.4);
  border-radius: min(8px, var(--wp-radius-cap, 999px));
}
</style>
