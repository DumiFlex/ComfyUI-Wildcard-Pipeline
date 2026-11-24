<script setup lang="ts">
/**
 * SeedsWidget — DOM widget for WP_Seeds, laid out like WP Toggles.
 *
 * Clean view: the seed rows (`SeedRow.vue`) under their labels, each with
 * the seed it gives the frame shown, a mode button (Follow → Random → Fixed),
 * "Use last run's seed" and a lock for that frame; a Frame stepper and
 * "Base seed from Loop" on top inside a Context Loop. The pencil in ComfyUI's selection
 * toolbar (`editRequest`) opens the edit view: grips to reorder, the row
 * pencil (its window, `SeedEditWindow.vue`) and bin, Add seed / Add label,
 * label names, Reroll and Done. A pinned row carries
 * `data-wp-out="seed_<out>"` so `extension/row-outputs.ts` puts its INT dot
 * at the row's right edge.
 *
 * Value contract: `modelValue` is a `SeedsConfig`; every edit emits the whole
 * next config (`src/widgets/seeds.ts` fits the outputs to it).
 */
import { computed, defineAsyncComponent, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import Input from "@/kit/Input.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import WpNumber from "@/kit/WpNumber.vue";
import SortableList from "@/kit/SortableList.vue";
import ColorField from "@/kit/ColorField.vue";
import IconPicker from "@/kit/IconPicker.vue";
import { currentFrame, setFrame } from "../context-loop/frame-cursor";
import SeedRowView from "./SeedRow.vue";
import { varColorIndex } from "../shared/var-color";
import {
  formatSeed,
  lockOf,
  nameKey,
  newSeedId,
  newSeedRow,
  rowSeed,
  seedGroups,
  seedProblems,
  seedRows,
  nextMode,
  withLastSeed,
  withLock,
  withMode,
  type SeedGroup,
  type SeedLabel,
  type SeedRow,
  type SeedsConfig,
  type SeedsItem,
} from "../../extension/seeds";
import type { LastRun } from "./types";
import { pickedColor } from "../../extension/looks";

const SeedEditWindow = defineAsyncComponent(() => import("./SeedEditWindow.vue"));

const props = withDefaults(
  defineProps<{
    modelValue: SeedsConfig;
    /** The base seed the rows use (the Loop's when Base seed from Loop is on). */
    baseSeed: number;
    /** The upstream Context Loop's seed, or null with no Loop. */
    loopSeed?: number | null;
    /** Row id → the seed it started from last run. */
    lastBases?: Record<string, number>;
    /** Frames the upstream Context Loop runs (1 without one). */
    frames?: number;
    /** What the last run used, per frame. */
    lastRun?: LastRun;
    /** Row name key → titles of the Contexts set to read it. */
    usedBy?: Record<string, string[]>;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Bumped by the pencil in ComfyUI's selection toolbar. */
    editRequest?: number;
    nodeTitle?: string;
  }>(),
  { frames: 1, loopSeed: null, lastBases: () => ({}), lastRun: () => ({}), usedBy: () => ({}), nodeMode: 0, editRequest: 0, nodeTitle: "" },
);
const emit = defineEmits<{
  "update:modelValue": [next: SeedsConfig];
  "reroll-base": [];
}>();

/** The frame shown (1-based). It follows the Context Loop's Edit frame
 *  (`frame-cursor.ts`, shared with the Context rows, Assembler and Debug)
 *  while one is picked, and stepping it picks that frame there too; on
 *  Base the node keeps its own. */
const ownFrame = ref(1);
const frame = computed<number>({
  get: () => {
    const k = currentFrame.value;
    if (k !== null && props.frames > 1 && k < props.frames) return k + 1;
    return Math.min(ownFrame.value, Math.max(1, props.frames));
  },
  set: (v: number) => {
    const n = Math.min(Math.max(1, Math.trunc(Number(v) || 1)), Math.max(1, props.frames));
    ownFrame.value = n;
    if (props.frames > 1) setFrame(n - 1);
  },
});
const followsLoop = computed(() => currentFrame.value !== null && props.frames > 1 && currentFrame.value < props.frames);
const index = computed(() => frame.value - 1);

const editMode = ref(!seedRows(props.modelValue).length);
const editing = ref<string | null>(null);
watch(() => props.editRequest, () => {
  editMode.value = !editMode.value;
  if (!editMode.value) editing.value = null;
});
const editingRow = computed(() => seedRows(props.modelValue).find((r) => r.id === editing.value) ?? null);

const problems = computed(() => seedProblems(props.modelValue));
const skipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const groups = computed(() => seedGroups(props.modelValue));
const seeds = computed(() => seedRows(props.modelValue));

function seedOf(r: SeedRow): number {
  return rowSeed(r, props.baseSeed, index.value);
}
function lastOf(r: SeedRow): number | undefined {
  return props.lastRun[String(index.value)]?.[r.id];
}
function seedHint(r: SeedRow): string {
  const last = lastOf(r);
  const lines = [`Frame ${frame.value}: ${formatSeed(seedOf(r))}`];
  if (last !== undefined) lines.push(`Last run: ${formatSeed(last)}`);
  const used = props.usedBy[nameKey(r.name)];
  lines.push(used?.length ? `Read by ${used.join(", ")}` : "No Context reads it yet");
  return lines.join("\n");
}
/** A label's colour as CSS: its own pick, else its variable colour (made
 *  from the name when none was chosen, as before labels had looks). */
function labelColor(l: SeedLabel): string {
  return l.hex ?? `var(--wp-var-${l.color ?? varColorIndex(l.name || l.id)})`;
}
const root = ref<HTMLElement | null>(null);
/** The colour picker's value for a label: its own pick, else the swatch it
 *  wears now, so the picker opens on the colour you see. */
function labelPickerValue(l: SeedLabel): string {
  if (l.hex) return l.hex;
  const el = root.value;
  const v = el ? getComputedStyle(el).getPropertyValue(`--wp-var-${l.color ?? varColorIndex(l.name || l.id)}`).trim() : "";
  return v || "none";
}
function setLabelColor(l: SeedLabel, v: string): void {
  patchLabel(l, { hex: pickedColor(v) });
}
function groupOfLabel(l: SeedLabel): SeedGroup {
  return groups.value.find((g) => g.label?.id === l.id) ?? { label: l, rows: [] };
}
function groupColorOf(r: SeedRow): string | undefined {
  const l = groups.value.find((g) => g.rows.some((x) => x.id === r.id))?.label;
  return l ? labelColor(l) : undefined;
}
/** A folded label carries its rows' output dots. */
function foldedOuts(g: SeedGroup): string | undefined {
  if (!g.label?.collapsed) return undefined;
  const names = g.rows.filter((r) => r.pin && r.out).map((r) => `seed_${r.out}`);
  return names.length ? names.join(" ") : undefined;
}
function countText(g: SeedGroup): string {
  const n = g.rows.length;
  const locked = g.rows.filter((r) => lockOf(r, index.value) !== undefined).length;
  return `${n} seed${n === 1 ? "" : "s"}${locked ? ` · ${locked} locked` : ""}`;
}

function emitRows(rows: SeedsItem[]): void {
  emit("update:modelValue", { ...props.modelValue, rows });
}
function replace(row: SeedsItem): void {
  emitRows(props.modelValue.rows.map((r) => (r.id === row.id ? row : r)));
}
function toggleLock(r: SeedRow): void {
  const locked = lockOf(r, index.value);
  // Lock what this frame used last run when there is one, else what it will use.
  replace(withLock(r, index.value, locked !== undefined ? null : (lastOf(r) ?? seedOf(r))));
}
function cycleMode(r: SeedRow): void {
  replace(withMode(r, nextMode(r.mode), props.baseSeed));
}
function useLast(r: SeedRow): void {
  const seed = props.lastBases[r.id];
  if (seed !== undefined) replace(withLastSeed(r, seed));
}
const fromLoop = computed(() => !!props.modelValue.base_from_loop && props.loopSeed !== null);
function setFromLoop(on: boolean): void {
  const next: SeedsConfig = { ...props.modelValue };
  if (on) next.base_from_loop = true;
  else delete next.base_from_loop;
  emit("update:modelValue", next);
}
function patchLabel(l: SeedLabel, p: Partial<SeedLabel>): void {
  const next: SeedLabel = { ...l, ...p };
  if (!next.collapsed) delete next.collapsed;
  if (!next.hex) delete next.hex;
  if (!next.icon) delete next.icon;
  replace(next);
}
function addSeed(): void {
  const row = newSeedRow(props.modelValue);
  emitRows([...props.modelValue.rows, row]);
  editing.value = row.id;
}
function addLabel(): void {
  emitRows([...props.modelValue.rows, { id: newSeedId(), kind: "label", name: "Group" }]);
}
function remove(id: string): void {
  if (editing.value === id) editing.value = null;
  emitRows(props.modelValue.rows.filter((r) => r.id !== id));
}
function applyWindow(next: SeedRow): void {
  replace(next);
  editing.value = null;
}
</script>

<template>
  <div ref="root" class="wp-sd" :class="{ 'wp-sd--skipped': skipped, 'wp-sd--edit': editMode }" data-test="seeds-widget">
    <div v-if="editMode || frames > 1 || loopSeed !== null" class="wp-sd__bar">
      <template v-if="frames > 1">
        <span class="wp-sd__cap">Frame</span>
        <WpNumber
          v-model="frame"
          :min="1"
          :max="frames"
          size="sm"
          class="wp-sd__frame"
          aria-label="Frame shown"
          :class="{ 'is-loop': followsLoop }"
          :title="followsLoop ? 'The frame picked in the Context Loop\'s Edit frame' : 'Pick a frame; the Context Loop\'s Edit frame follows'"
          :suffix="`/ ${frames}`"
          data-test="seeds-frame"
        />
      </template>
      <span class="wp-sd__spacer" />
      <Button
        v-if="loopSeed !== null"
        size="sm"
        variant="ghost"
        icon="pi-replay"
        :pressed="fromLoop"
        :hint="fromLoop
          ? `Base seed from Loop: the rows follow the Context Loop's seed (${formatSeed(loopSeed)}). Click to use this node's own`
          : 'Base seed from Loop: follow the Context Loop\'s seed instead of this node\'s base_seed'"
        data-test="seeds-from-loop"
        @click="setFromLoop(!fromLoop)"
      >From Loop</Button>
      <Button
        size="sm"
        variant="ghost"
        icon="pi-refresh"
        :disabled="fromLoop"
        :hint="fromLoop
          ? 'The base seed comes from the Loop: change the Loop\'s seed'
          : 'New base seed: every row that follows it moves; locked frames stay'"
        data-test="seeds-reroll"
        @click="emit('reroll-base')"
      >Reroll</Button>
      <Button v-if="editMode" variant="primary" size="sm" icon="pi-check" data-test="seeds-edit-done" @click="editMode = false; editing = null">Done</Button>
    </div>

    <!-- Clean view: rows under their labels, no grips. -->
    <template v-if="!editMode">
      <div v-for="(g, gi) in groups" :key="g.label?.id ?? `top-${gi}`" class="wp-sd__group">
        <div
          v-if="g.label"
          class="wp-sd__label"
          :style="{ color: labelColor(g.label) }"
          :data-wp-out="foldedOuts(g)"
          :data-test="`seeds-label-${g.label.id}`"
        >
          <WpIconButton
            variant="bare"
            :icon="g.label.collapsed ? 'pi-caret-right' : 'pi-caret-down'"
            :label="g.label.collapsed ? 'Unfold' : 'Fold'"
            @click="g.label && patchLabel(g.label, { collapsed: !g.label.collapsed })"
          />
          <i v-if="g.label.icon" class="pi wp-sd__label-icon" :class="`pi-${g.label.icon}`" aria-hidden="true" />
          <span class="wp-sd__label-text">{{ g.label.name || "Group" }}</span>
          <span class="wp-sd__rule" />
          <span class="wp-sd__count">{{ countText(g) }}</span>
        </div>
        <template v-if="!g.label?.collapsed">
          <SeedRowView
            v-for="r in g.rows"
            :key="r.id"
            :r="r"
            :seed="seedOf(r)"
            :frame="frame"
            :locked="lockOf(r, index) !== undefined"
            :hint="seedHint(r)"
            :problem="problems.get(r.id)"
            :last-seed="lastBases[r.id]"
            @lock="toggleLock(r)"
            @cycle="cycleMode(r)"
            @last="useLast(r)"
          />
        </template>
      </div>
      <div v-if="!seeds.length" class="wp-sd__ghost">No seeds yet: select the node and press the pencil above it.</div>
    </template>

    <!-- Edit view: one sortable list of rows and labels. -->
    <template v-else>
      <SortableList
        v-if="modelValue.rows.length"
        :model-value="modelValue.rows"
        :item-key="(r: SeedsItem) => r.id"
        :item-label="(r: SeedsItem) => r.name || (r.kind === 'label' ? 'Group' : 'Seed')"
        label="Seeds and labels"
        size="sm"
        @update:model-value="emitRows"
      >
        <template #item="{ item }">
          <div
            v-if="item.kind === 'label'"
            class="wp-sd__label"
            :style="{ color: labelColor(item) }"
            :data-wp-out="foldedOuts(groupOfLabel(item))"
            :data-test="`seeds-label-${item.id}`"
          >
            <Input
              size="sm"
              class="wp-sd__label-name"
              :model-value="item.name"
              placeholder="Group name"
              spellcheck="false"
              aria-label="Group name"
              @keydown.stop
              @change="patchLabel(item, { name: ($event.target as HTMLInputElement).value.trim() })"
            />
            <span class="wp-sd__rule" />
            <span class="wp-sd__count">{{ countText(groupOfLabel(item)) }}</span>
            <IconPicker
              :model-value="item.icon ?? null"
              all
              compact
              size="sm"
              :color="labelColor(item)"
              aria-label="Group icon"
              :data-test="`seeds-label-icon-${item.id}`"
              @update:model-value="(v: string | null) => patchLabel(item, { icon: v || undefined })"
            />
            <ColorField
              :model-value="labelPickerValue(item)"
              presets
              compact
              aria-label="Group colour"
              :data-test="`seeds-label-color-${item.id}`"
              @update:model-value="(v: string) => setLabelColor(item, v)"
            />
            <WpIconButton
              icon="pi-times"
              tone="danger"
              label="Remove label"
              hint="Remove the label; its seeds join the group above"
              :data-test="`seeds-label-remove-${item.id}`"
              @click="remove(item.id)"
            />
          </div>
          <div
            v-else
            class="wp-sd__member"
            :class="{ 'is-grouped': groupColorOf(item) }"
            :style="groupColorOf(item) ? { '--wp-sd-group': groupColorOf(item) } : undefined"
          >
            <SeedRowView
              :r="item"
              :seed="seedOf(item)"
              :frame="frame"
              :locked="lockOf(item, index) !== undefined"
              :hint="seedHint(item)"
              :problem="problems.get(item.id)"
              :last-seed="lastBases[item.id]"
              editable
              :editing="editing === item.id"
              @lock="toggleLock(item)"
              @cycle="cycleMode(item)"
              @last="useLast(item)"
              @edit="editing = editing === item.id ? null : item.id"
              @remove="remove(item.id)"
            />
          </div>
        </template>
      </SortableList>
      <div v-if="!seeds.length" class="wp-sd__ghost">No seeds yet. Add one for each Context or sampler that needs its own.</div>
      <div class="wp-sd__adds">
        <Button size="sm" variant="add" icon="pi-plus" block data-test="seeds-add" @click="addSeed">Add seed</Button>
        <Button size="sm" variant="add" icon="pi-tag" data-test="seeds-add-label" @click="addLabel">Add label</Button>
      </div>
    </template>

    <SeedEditWindow
      v-if="editingRow"
      :key="editingRow.id"
      :row="editingRow"
      :config="modelValue"
      :base-seed="baseSeed"
      :last-seed="lastBases[editingRow.id]"
      :frames="frames"
      :last-run="lastRun"
      :used-by="usedBy[nameKey(editingRow.name)] ?? []"
      :node-title="nodeTitle"
      @done="applyWindow"
      @cancel="editing = null"
    />
  </div>
</template>

<style scoped>
.wp-sd {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  padding: 4px 0;
  min-width: 0;
}
.wp-sd--skipped { opacity: 0.45; }
.wp-sd__bar { display: flex; align-items: center; gap: 8px; min-width: 0; margin-bottom: 4px; }
.wp-sd__cap { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-sd__frame { width: 96px; }
.wp-sd__spacer { flex: 1; }
.wp-sd__group { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-sd__label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 2px;
  min-width: 0;
}
.wp-sd--edit .wp-sd__label { min-height: 38px; }
.wp-sd__label-icon { font-size: 11px; }
.wp-sd__frame.is-loop { box-shadow: 0 0 0 1px color-mix(in srgb, var(--wp-accent) 55%, transparent); border-radius: min(4px, var(--wp-radius-cap, 999px)); }
.wp-sd__label-text {
  font: 600 11px var(--wp-font-sans, sans-serif);
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-sd__label-name { flex: 0 1 auto; width: 14ch; min-width: 4ch; color: inherit; }
.wp-sd__rule { flex: 1; height: 1px; background: currentColor; opacity: 0.25; }
.wp-sd__count { font: 10.5px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
.wp-sd__member { display: flex; flex: 1; min-width: 0; }
.wp-sd__member.is-grouped { padding-left: 8px; border-left: 2px solid var(--wp-sd-group, var(--wp-border)); }
.wp-sd :deep(.wp-sortable__row) { background: transparent; align-items: flex-start; }
.wp-sd :deep(.wp-sortable__grip) { align-self: flex-start; height: 38px; min-height: 38px; }
.wp-sd__ghost {
  padding: 4px;
  font-size: 10.5px;
  font-style: italic;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-sd__adds { display: flex; gap: 6px; margin-top: 4px; }
.wp-sd__adds > :first-child { flex: 1; }
</style>
