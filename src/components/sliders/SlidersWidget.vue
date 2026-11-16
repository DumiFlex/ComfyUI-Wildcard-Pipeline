<script setup lang="ts">
/**
 * SlidersWidget — DOM widget for WP_Slider.
 *
 * Rows are sliders and labels. A slider writes `$var` (the number, its text
 * or the word of its range) and, when it has an output, drives one number
 * output; its row carries `data-wp-out="value_<out>"` so
 * `extension/row-outputs.ts` puts that dot at the row's right edge. A folded
 * label gathers its sliders' dots.
 *
 * Two views, like WP Toggles: the clean view shows the rows and their
 * tracks; the pencil in ComfyUI's selection toolbar (`editRequest`) opens
 * the edit view (grips, row buttons, add buttons) and Done closes it. A
 * node with no sliders opens in the edit view. A row's pencil opens the
 * slider's own settings in a window (`SliderEditWindow.vue`).
 *
 * Value contract: `modelValue` is a `SlidersConfig`; every edit emits the
 * whole next config (`src/widgets/sliders.ts` fits the outputs to it).
 */
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import Input from "@/kit/Input.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import ColorField from "@/kit/ColorField.vue";
import IconPicker from "@/kit/IconPicker.vue";
import SortableList from "@/kit/SortableList.vue";
import SliderRowView from "./SliderRow.vue";
import {
  MAX_OUTPUTS,
  dropSliderRow,
  groupsOf,
  newSlider,
  newSliderLabel,
  sliderProblems,
  sliderRows,
  uniqueVar,
  varFromName,
  visibleRows,
  type SliderDropEdge,
  type SliderGroup,
  type SliderLabelRow,
  type SliderRow,
  type SlidersConfig,
  type SlidersItem,
} from "../../extension/sliders";
import { revealTarget } from "../../widgets/flash-target";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";

const SliderEditWindow = defineAsyncComponent(() => import("./SliderEditWindow.vue"));

const props = withDefaults(
  defineProps<{
    modelValue: SlidersConfig;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Bumped by the pencil in ComfyUI's selection toolbar. */
    editRequest?: number;
    /** Variables upstream of the node, for a Text's `$` list. */
    upstreamVars?: string[];
    varProducers?: Map<string, VarProducerLike> | undefined;
    nodeTitle?: string;
  }>(),
  { nodeMode: 0, editRequest: 0, upstreamVars: () => [], varProducers: undefined, nodeTitle: "" },
);
const emit = defineEmits<{ "update:modelValue": [next: SlidersConfig] }>();

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const cfg = computed(() => props.modelValue);
const problems = computed(() => sliderProblems(cfg.value));
const groups = computed(() => groupsOf(cfg.value));
const sliders = computed(() => sliderRows(cfg.value));
const byId = computed(() => new Map(sliders.value.map((s) => [s.id, s])));
const pinCount = computed(() => sliders.value.filter((s) => s.pin).length);

function setRows(rows: SlidersConfig["rows"]): void {
  emit("update:modelValue", { ...cfg.value, rows });
}
function patchSlider(id: string, patch: Partial<SliderRow>): void {
  setRows(cfg.value.rows.map((r) => {
    if (r.id !== id || r.kind !== "slider") return r;
    const next: Record<string, unknown> = { ...r, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return next as unknown as SliderRow;
  }));
}
function patchLabel(id: string, patch: Partial<SliderLabelRow>): void {
  setRows(cfg.value.rows.map((r) => (r.id === id && r.kind === "label" ? { ...r, ...patch } : r)));
}

/* ── views ────────────────────────────────────────────────────────────── */

const editing = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
const editMode = ref(!sliderRows(props.modelValue).length);
function closeEdit(): void {
  editMode.value = false;
  editing.value = null;
}
watch(() => props.editRequest, () => {
  if (editMode.value) closeEdit();
  else editMode.value = true;
});

function addSlider(): void {
  const s = newSlider(cfg.value);
  setRows([...cfg.value.rows, s]);
  editing.value = s.id;
}
function addLabel(): void {
  const used = new Set(cfg.value.rows.filter((r): r is SliderLabelRow => r.kind === "label").map((r) => r.color));
  const label = newSliderLabel(cfg.value);
  label.color = [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 1;
  setRows([...cfg.value.rows, label]);
  void nextTick(() => {
    const inputs = root.value?.querySelectorAll<HTMLInputElement>(".wp-sl__label-name input");
    inputs?.[inputs.length - 1]?.select();
  });
}
function removeSlider(s: SliderRow): void {
  setRows(cfg.value.rows.filter((r) => r.id !== s.id));
  if (editing.value === s.id) editing.value = null;
}
/** Remove a label; its sliders join the group above. */
function removeLabel(l: SliderLabelRow): void {
  setRows(cfg.value.rows.filter((r) => r.id !== l.id));
}

/* ── the window ───────────────────────────────────────────────────────── */

const editingRow = computed(() => (editing.value ? byId.value.get(editing.value) : undefined));
const valueVars = computed(() => {
  const own = sliders.value.map((s) => s.var).filter(Boolean);
  return [...new Set([...props.upstreamVars, ...own])];
});
function groupOptions(): { value: string; label: string }[] {
  if (!groups.value.some((g) => g.label)) return [];
  return groups.value
    .filter((g, i) => g.label || i === 0)
    .map((g) => ({ value: g.label?.id ?? "", label: g.label ? (g.label.name || "Group") : "No label (top)" }));
}
function groupIdOf(s: SliderRow): string {
  return groups.value.find((g) => g.sliders.some((x) => x.id === s.id))?.label?.id ?? "";
}
/** Done in a slider's window: store its draft, moving it to its group. */
function applyWindow(s: SliderRow, next: SliderRow, groupId: string): void {
  editing.value = null;
  let row: SliderRow = { ...next, id: s.id, kind: "slider" };
  const name = row.name.trim() || s.name;
  if (name !== s.name && row.var === s.var) {
    // A variable that still follows the old name follows the new one.
    const follows = !s.var || s.var === uniqueVar(varFromName(s.name), cfg.value, s.id);
    if (follows) row = { ...row, var: uniqueVar(varFromName(name) || s.var, cfg.value, s.id) };
  }
  row = { ...row, name };
  const rows = cfg.value.rows.filter((r) => r.id !== s.id);
  if (groupId === groupIdOf(s)) {
    setRows(cfg.value.rows.map((r) => (r.id === s.id ? row : r)));
    return;
  }
  // Last in the chosen group (the top group: before the first label).
  const firstLabel = rows.findIndex((r) => r.kind === "label");
  let at: number;
  if (!groupId) at = firstLabel < 0 ? rows.length : firstLabel;
  else {
    const li = rows.findIndex((r) => r.id === groupId);
    const nextLabel = rows.findIndex((r, i) => i > li && r.kind === "label");
    at = nextLabel < 0 ? rows.length : nextLabel;
    rows[li] = { ...(rows[li] as SliderLabelRow), collapsed: false };
  }
  setRows([...rows.slice(0, at), row, ...rows.slice(at)]);
}

/* ── ordering ─────────────────────────────────────────────────────────── */

const shownRows = computed(() => visibleRows(cfg.value));
function dropPlanFor(d: { from: number; over: number; edge: SliderDropEdge }): SlidersItem[] | null {
  const from = shownRows.value[d.from];
  const over = shownRows.value[d.over];
  return from && over ? dropSliderRow(cfg.value, from.id, over.id, d.edge) : null;
}
function onDrop(d: { from: number; over: number; edge: SliderDropEdge }): void {
  const rows = dropPlanFor(d);
  if (rows) setRows(rows);
}
function groupKey(g: SliderGroup): string {
  return g.label?.id ?? "top";
}
function groupOfLabel(l: SliderLabelRow): SliderGroup {
  return groups.value.find((g) => g.label?.id === l.id) ?? { label: l, sliders: [] };
}
function labelColor(l: SliderLabelRow): string {
  return l.hex ?? `var(--wp-var-${l.color})`;
}
function groupColorOf(s: SliderRow): string | undefined {
  const l = groups.value.find((x) => x.sliders.some((y) => y.id === s.id))?.label;
  return l ? labelColor(l) : undefined;
}
function labelPickerValue(l: SliderLabelRow): string {
  if (l.hex) return l.hex;
  const el = root.value;
  const v = el ? getComputedStyle(el).getPropertyValue(`--wp-var-${l.color}`).trim() : "";
  return v || "none";
}
function setLabelColor(l: SliderLabelRow, v: string): void {
  patchLabel(l.id, { hex: /^#[0-9a-f]{6}$/i.test(v.slice(0, 7)) ? v.slice(0, 7).toLowerCase() : undefined });
}
/** Output names a folded label shows the dots of. */
function foldedOuts(g: SliderGroup): string | undefined {
  if (!g.label?.collapsed) return undefined;
  const names = g.sliders.filter((s) => s.pin && s.out).map((s) => `value_${s.out}`);
  return names.length ? names.join(" ") : undefined;
}
/** WP Debug "Show node": unfold the groups that hide its slider. */
function onReveal(ev: Event): void {
  const want = new Set(revealTarget(ev)?.vars ?? []);
  if (!want.size) return;
  const open = new Set(groups.value.filter((g) => g.label?.collapsed && g.sliders.some((s) => want.has(s.var))).map((g) => g.label?.id));
  if (open.size) setRows(cfg.value.rows.map((r) => (r.kind === "label" && open.has(r.id) ? { ...r, collapsed: false } : r)));
}
function rowProps(s: SliderRow) {
  return { s, problem: problems.value.get(s.id), editing: editing.value === s.id, editable: editMode.value };
}
</script>

<template>
  <div ref="root" class="wp-sl" data-wp-reveal :class="{ 'wp-sl--skipped': isSkipped, 'wp-sl--edit': editMode }" @wp-reveal="onReveal">
    <div v-if="editMode" class="wp-sl__bar">
      <span class="wp-sl__cap">{{ sliders.length }} slider{{ sliders.length === 1 ? '' : 's' }}<template v-if="pinCount"> · {{ pinCount }} output{{ pinCount === 1 ? '' : 's' }}</template></span>
      <Button variant="primary" size="sm" icon="pi-check" data-test="sl-edit-done" @click="closeEdit">Done</Button>
    </div>

    <template v-if="!editMode">
      <div v-for="g in groups" :key="groupKey(g)" class="wp-sl__group-box" :data-wp-part="`group:${groupKey(g)}`">
        <div v-if="g.label" class="wp-sl__label" :style="{ color: labelColor(g.label) }" :data-wp-out="foldedOuts(g)" :data-test="`sl-label-${g.label.id}`">
          <WpIconButton
            variant="bare"
            :icon="g.label.collapsed ? 'pi-caret-right' : 'pi-caret-down'"
            :label="g.label.collapsed ? 'Unfold' : 'Fold'"
            :data-test="`sl-fold-${g.label.id}`"
            @click="patchLabel(g.label.id, { collapsed: !g.label.collapsed })"
          />
          <i v-if="g.label.icon" class="pi wp-sl__label-icon" :class="`pi-${g.label.icon}`" aria-hidden="true" />
          <span class="wp-sl__label-text">{{ g.label.name || "Group" }}</span>
          <span class="wp-sl__rule" />
          <span class="wp-sl__count">{{ g.sliders.length }}</span>
        </div>
        <template v-if="!g.label?.collapsed">
          <SliderRowView
            v-for="item in g.sliders"
            :key="item.id"
            v-bind="rowProps(item)"
            :data-wp-part="`slider:${item.id}`"
            :data-wp-part-label="item.name || 'Slider'"
            @set-value="(v: number) => patchSlider(item.id, { value: v })"
          />
        </template>
      </div>
    </template>

    <template v-else>
      <SortableList
        v-if="shownRows.length"
        :model-value="shownRows"
        :item-key="(r: SlidersItem) => r.id"
        :item-label="(r: SlidersItem) => r.name || (r.kind === 'label' ? 'Group' : 'Slider')"
        label="Sliders and labels"
        size="sm"
        class="wp-sl__list"
        end-zone
        :drop-line="(d: { from: number; over: number; edge: SliderDropEdge }) => !!dropPlanFor(d)"
        @drop="onDrop"
      >
        <template #item="{ item }">
          <div
            v-if="item.kind === 'label'"
            class="wp-sl__label"
            :style="{ color: labelColor(item) }"
            :data-wp-out="foldedOuts(groupOfLabel(item))"
            :data-test="`sl-label-${item.id}`"
          >
            <WpIconButton
              variant="bare"
              :icon="item.collapsed ? 'pi-caret-right' : 'pi-caret-down'"
              :label="item.collapsed ? 'Unfold' : 'Fold'"
              @click="patchLabel(item.id, { collapsed: !item.collapsed })"
            />
            <Input
              size="sm"
              class="wp-sl__label-name"
              :model-value="item.name"
              placeholder="Group name"
              spellcheck="false"
              aria-label="Group name"
              @keydown.stop
              @change="patchLabel(item.id, { name: ($event.target as HTMLInputElement).value.trim() })"
            />
            <span class="wp-sl__rule" />
            <span class="wp-sl__count">{{ groupOfLabel(item).sliders.length }}</span>
            <IconPicker
              :model-value="item.icon ?? null"
              all
              compact
              size="sm"
              :color="labelColor(item)"
              aria-label="Group icon"
              @update:model-value="(v: string | null) => patchLabel(item.id, { icon: v || undefined })"
            />
            <ColorField :model-value="labelPickerValue(item)" presets compact aria-label="Group colour" @update:model-value="(v: string) => setLabelColor(item, v)" />
            <WpIconButton
              icon="pi-times"
              tone="danger"
              label="Remove label"
              hint="Remove the label; its sliders join the group above"
              :data-test="`sl-label-remove-${item.id}`"
              @click="removeLabel(item)"
            />
          </div>
          <div
            v-else
            class="wp-sl__member"
            :class="{ 'is-grouped': groupColorOf(item) }"
            :style="groupColorOf(item) ? { '--wp-sl-group': groupColorOf(item) } : undefined"
          >
            <SliderRowView
              v-bind="rowProps(item)"
              @set-value="(v: number) => patchSlider(item.id, { value: v })"
              @patch="(p: Partial<SliderRow>) => patchSlider(item.id, p)"
              @edit="editing = editing === item.id ? null : item.id"
              @remove="removeSlider(item)"
            />
          </div>
        </template>
      </SortableList>
      <div v-if="!sliders.length" class="wp-sl__ghost">No sliders yet.</div>
      <div class="wp-sl__adds">
        <Button size="sm" variant="add" icon="pi-plus" block data-test="sl-add" @click="addSlider">Add slider</Button>
        <Button size="sm" variant="add" icon="pi-tag" data-test="sl-add-label" @click="addLabel">Add label</Button>
      </div>
    </template>
    <div v-if="!editMode && !sliders.length" class="wp-sl__ghost">No sliders yet: select the node and press the pencil above it.</div>
    <SliderEditWindow
      v-if="editingRow"
      :key="editingRow.id"
      :s="editingRow"
      :problem="problems.get(editingRow.id)"
      :group-options="groupOptions()"
      :group-id="groupIdOf(editingRow)"
      :outputs-full="pinCount >= MAX_OUTPUTS"
      :var-suggestions="valueVars"
      :var-producers="varProducers"
      :node-title="nodeTitle"
      @done="(next: SliderRow, groupId: string) => editingRow && applyWindow(editingRow, next, groupId)"
      @cancel="editing = null"
    />
  </div>
</template>

<style scoped>
.wp-sl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  padding: 4px 0;
  min-width: 0;
}
.wp-sl--skipped { opacity: 0.45; }
.wp-sl__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.wp-sl__cap { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-sl__group-box { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-sl :deep(.wp-sortable__row) { background: transparent; align-items: flex-start; }
.wp-sl :deep(.wp-sortable__grip) { align-self: flex-start; height: 34px; min-height: 34px; }
.wp-sl__member { flex: 1; min-width: 0; }
.wp-sl__member.is-grouped { padding-left: 8px; border-left: 2px solid var(--wp-sl-group, var(--wp-border)); }
.wp-sl__label { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 2px; min-width: 0; }
.wp-sl--edit .wp-sl__label { min-height: 34px; }
.wp-sl__label-icon { font-size: 11px; }
.wp-sl__label-text { font: 600 11px var(--wp-font-sans, sans-serif); padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-sl__label-name { flex: 0 1 auto; width: 12ch; min-width: 4ch; }
.wp-sl__rule { flex: 1; height: 1px; background: currentColor; opacity: 0.25; }
.wp-sl__count { font: 10.5px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
.wp-sl__ghost { padding: 4px; font-size: 10.5px; font-style: italic; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-sl__adds { display: flex; gap: 6px; }
.wp-sl__adds > :first-child { flex: 1; }
</style>
