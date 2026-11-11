<script setup lang="ts">
/**
 * TogglesWidget — DOM widget for WP_Toggles.
 *
 * Rows are toggles and labels. A toggle writes `$var` = true/false (always
 * internal) and, when it has an output, drives one BOOLEAN; its row carries
 * `data-wp-out="toggle_<out>"` so `extension/row-outputs.ts` puts that dot
 * at the row's right edge. A folded label gathers its toggles' dots.
 *
 * Two views: the clean view shows only the rows and their controls; the
 * pencil in ComfyUI's selection toolbar (`editRequest`) opens the edit view
 * (mode, Pick one options, grips, row buttons, add buttons) and Done closes
 * it. A node with no toggles opens in the edit view. The view is per
 * session, never saved. A row's pencil opens that toggle's own settings in
 * a window (`ToggleEditWindow.vue`) with a preview of the row.
 *
 * Toggles belong to the label above them. One sortable list holds labels
 * and toggles, so a toggle drags into or out of a group and a label drags
 * with its toggles (`dragRow`); the edit panel's Group field moves one too.
 *
 * Value contract: `modelValue` is a `TogglesConfig`; every edit emits the
 * whole next config (`src/widgets/toggles.ts` fits the outputs to it).
 */
import { computed, defineAsyncComponent, nextTick, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import Input from "@/kit/Input.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import ColorField from "@/kit/ColorField.vue";
import IconSwatch from "./IconSwatch.vue";
import SortableList from "@/kit/SortableList.vue";
import Checkbox from "@/kit/Checkbox.vue";
import { vTooltip } from "@/kit/tooltip";
import ToggleRowView from "./ToggleRow.vue";
import { varColorClass } from "../shared/var-color";
import {
  MAX_OUTPUTS,
  effectiveToggles,
  groupsOf,
  needsDepth,
  needsLoop,
  newToggle,
  newToggleId,
  rowsOf,
  toggleProblems,
  toggleRows,
  uniqueVar,
  varFromName,
  type LabelRow,
  type ToggleGroup,
  type ToggleRow,
  type TogglesConfig,
  type TogglesMode,
  type TogglesItem,
  type PickStyle,
  dragRow,
  visibleRows,
} from "../../extension/toggles";
import type { ControlState } from "../../extension/toggle-control";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";
import { vToggleRow } from "@/kit/toggle-row";

// The window loads on first open only: most canvases never edit a toggle.
const ToggleEditWindow = defineAsyncComponent(() => import("./ToggleEditWindow.vue"));

const props = withDefaults(
  defineProps<{
    modelValue: TogglesConfig;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Toggle id → its mute / bypass icon state (absent: nothing wired). */
    controls?: Record<string, ControlState>;
    /** Canvas group titles, for the control's group picker. */
    canvasGroups?: string[];
    /** Bumped by the pencil in ComfyUI's selection toolbar: opens the
     *  edit window (extension/node-toolbar.ts). */
    editRequest?: number;
    /** Variables upstream of the node, for the Pick one Value's `$` list. */
    upstreamVars?: string[];
    /** Who writes each upstream variable (the Value's chip hover card). */
    varProducers?: Map<string, VarProducerLike> | undefined;
    /** The node's title, for the toggle window's header. */
    nodeTitle?: string;
  }>(),
  {
    nodeMode: 0, controls: () => ({}), canvasGroups: () => [], editRequest: 0, upstreamVars: () => [],
    varProducers: undefined, nodeTitle: "",
  },
);
const emit = defineEmits<{ "update:modelValue": [next: TogglesConfig] }>();

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const cfg = computed(() => props.modelValue);
const isOne = computed(() => cfg.value.mode === "one");
const eff = computed(() => effectiveToggles(cfg.value));
const problems = computed(() => toggleProblems(cfg.value));
const groups = computed(() => groupsOf(cfg.value));
const toggles = computed(() => toggleRows(cfg.value));
const byId = computed(() => new Map(toggles.value.map((t) => [t.id, t])));
const pinCount = computed(() => toggles.value.filter((t) => t.pin).length);

function commit(next: Partial<TogglesConfig>): void {
  emit("update:modelValue", { ...cfg.value, ...next });
}
function setRows(rows: TogglesConfig["rows"]): void {
  commit({ rows });
}
function patchToggle(id: string, patch: Partial<ToggleRow>): void {
  setRows(cfg.value.rows.map((r) => (r.id === id && r.kind === "toggle" ? { ...r, ...patch } : r)));
}
function patchLabel(id: string, patch: Partial<LabelRow>): void {
  setRows(cfg.value.rows.map((r) => (r.id === id && r.kind === "label" ? { ...r, ...patch } : r)));
}

/* ── mode ─────────────────────────────────────────────────────────────── */

const PICK_STYLE_OPTIONS: { value: PickStyle; label: string; hint: string }[] = [
  { value: "radio", label: "Radio", hint: "A round dot on every row" },
  { value: "chip", label: "Chip", hint: "A chip with the name across the row, lit when picked" },
  { value: "switch", label: "Switch", hint: "A sliding switch on every row; turning one on turns the others off" },
  { value: "checkbox", label: "Check", hint: "A checkbox on every row; ticking one clears the others" },
];

const MODES = [
  { value: "any" as TogglesMode, label: "Any on", hint: "Each toggle is on or off by itself" },
  { value: "one" as TogglesMode, label: "Pick one", hint: "Exactly one toggle is on at a time" },
];
function setMode(mode: TogglesMode): void {
  if (mode === cfg.value.mode) return;
  if (mode === "one") {
    // Keep only the first toggle that is on.
    const first = toggles.value.find((t) => t.on)?.id;
    commit({ mode, rows: cfg.value.rows.map((r) => (r.kind === "toggle" && r.on && r.id !== first ? { ...r, on: false } : r)) });
  } else {
    commit({ mode });
  }
}
function setGroupVar(ev: Event): void {
  commit({ group_var: (ev.target as HTMLInputElement).value.trim().replace(/^\$/, "") });
}

/* ── switching ────────────────────────────────────────────────────────── */

function parentOf(t: ToggleRow): ToggleRow | undefined {
  return !isOne.value && t.needs ? byId.value.get(t.needs) : undefined;
}
/** Off because the toggle it needs is off (its own choice is kept). */
function isBlocked(t: ToggleRow): boolean {
  const p = parentOf(t);
  return !!p && !eff.value.get(p.id);
}
function setOn(t: ToggleRow, on: boolean): void {
  if (isBlocked(t)) return;
  if (isOne.value) {
    setRows(cfg.value.rows.map((r) => (r.kind === "toggle" ? { ...r, on: r.id === t.id ? on : false } : r)));
  } else {
    patchToggle(t.id, { on });
  }
}
/** What the control shows: Pick one shows the pick, Any on the own choice. */
function shownOn(t: ToggleRow): boolean {
  return isOne.value ? !!eff.value.get(t.id) : t.on;
}

/* ── rows ─────────────────────────────────────────────────────────────── */

/** The toggle whose window is open. */
const editing = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
/** Edit view (see the header comment). */
const editMode = ref(!toggleRows(props.modelValue).length);

function openEdit(): void {
  editMode.value = true;
}
function closeEdit(): void {
  editMode.value = false;
  editing.value = null;
}
watch(
  () => props.editRequest,
  () => {
    if (editMode.value) closeEdit();
    else openEdit();
  },
);

function addToggle(): void {
  const t = newToggle(cfg.value);
  if (pinCount.value >= MAX_OUTPUTS) t.pin = false;
  setRows([...cfg.value.rows, t]);
  editing.value = t.id;
}
function addLabel(): void {
  const used = new Set(cfg.value.rows.filter((r): r is LabelRow => r.kind === "label").map((r) => r.color));
  const color = [1, 2, 3, 4, 5, 6, 7, 8].find((c) => !used.has(c)) ?? 1;
  const label: LabelRow = { id: newToggleId(), kind: "label", name: "Group", color };
  setRows([...cfg.value.rows, label]);
  void nextTick(() => {
    const inputs = root.value?.querySelectorAll<HTMLInputElement>(".wp-tg__label-name");
    inputs?.[inputs.length - 1]?.select();
  });
}
function removeToggle(t: ToggleRow): void {
  setRows(cfg.value.rows
    .filter((r) => r.id !== t.id)
    .map((r) => (r.kind === "toggle" && r.needs === t.id ? { ...r, needs: undefined } : r)));
  if (editing.value === t.id) editing.value = null;
}
/** Remove a label; its toggles join the group above. */
function removeLabel(l: LabelRow): void {
  setRows(cfg.value.rows.filter((r) => r.id !== l.id));
}

function toggleEdit(t: ToggleRow): void {
  editing.value = editing.value === t.id ? null : t.id;
}
/** The toggle whose window is open (gone if it was removed meanwhile). */
const editingRow = computed(() => (editing.value ? byId.value.get(editing.value) : undefined));
function windowProps(t: ToggleRow) {
  return { ...rowProps(t), nodeTitle: props.nodeTitle };
}
/** Done in a toggle's window: store its draft, moving it to its group. */
function applyWindow(t: ToggleRow, next: ToggleRow, groupId: string): void {
  editing.value = null;
  let row: ToggleRow = { ...next, id: t.id, kind: "toggle" };
  const name = row.name.trim() || t.name;
  if (name !== t.name && row.var === t.var) {
    // A variable that still follows the old name follows the new one.
    const follows = !t.var || t.var === uniqueVar(varFromName(t.name), cfg.value, t.id);
    if (follows) row = { ...row, var: uniqueVar(varFromName(name) || t.var, cfg.value, t.id) };
  }
  row = { ...row, name };
  const rows = cfg.value.rows.map((r) => (r.id === t.id ? row : r));
  if (groupId === groupIdOf(t)) {
    setRows(rows);
    return;
  }
  const next2: ToggleGroup[] = groupsOf({ ...cfg.value, rows }).map((g) => ({ label: g.label, toggles: g.toggles.filter((x) => x.id !== t.id) }));
  const target = next2.find((g) => (g.label?.id ?? "") === groupId);
  if (!target) {
    setRows(rows);
    return;
  }
  target.toggles.push(row);
  if (target.label?.collapsed) target.label = { ...target.label, collapsed: false };
  setRows(rowsOf(next2));
}
/** `$` names a Pick one Value can read: upstream's, then the toggles' own. */
const valueVars = computed(() => {
  const own = toggleRows(cfg.value).map((r) => r.var).filter(Boolean);
  return [...new Set([...props.upstreamVars, ...own])];
});
function rowProps(t: ToggleRow) {
  const p = parentOf(t);
  return {
    t,
    pickOne: isOne.value,
    pickStyle: (cfg.value.pick_style ?? "radio") as PickStyle,
    shownOn: shownOn(t),
    effOn: !!eff.value.get(t.id),
    parentName: p?.name ?? "",
    blocked: isBlocked(t),
    problem: problems.value.get(t.id),
    indent: isOne.value ? 0 : needsDepth(cfg.value, t.id) * 14,
    editing: editing.value === t.id,
    needsOptions: needsOptions(t),
    groupOptions: labelled.value.length ? groupOptions() : [],
    groupId: groupIdOf(t),
    outputsFull: pinCount.value >= MAX_OUTPUTS,
    editable: editMode.value,
    controlState: props.controls[t.id] ?? null,
    canvasGroups: props.canvasGroups,
    varSuggestions: valueVars.value,
    varProducers: props.varProducers,
  };
}


function needsOptions(t: ToggleRow): { value: string; label: string }[] {
  return [
    { value: "", label: "Nothing (works on its own)" },
    ...toggles.value
      .filter((o) => o.id !== t.id && !needsLoop(cfg.value, t.id, o.id))
      .map((o) => ({ value: o.id, label: o.name })),
  ];
}

function groupOptions(): { value: string; label: string }[] {
  return groups.value.map((g) => ({ value: g.label?.id ?? "", label: g.label ? (g.label.name || "Group") : "No label (top)" }));
}
function groupIdOf(t: ToggleRow): string {
  return groups.value.find((g) => g.toggles.some((x) => x.id === t.id))?.label?.id ?? "";
}
/* ── ordering ─────────────────────────────────────────────────────────── */

type LabelledGroup = ToggleGroup & { label: LabelRow };
const labelled = computed(() => groups.value.filter((g): g is LabelledGroup => g.label !== null));
/** The edit view's rows: labels and the toggles of unfolded groups. */
const shownRows = computed(() => visibleRows(cfg.value));
function groupOfLabel(l: LabelRow): ToggleGroup {
  return groups.value.find((g) => g.label?.id === l.id) ?? { label: l, toggles: [] };
}
/** A label's colour as CSS: its own pick, else its variable colour. */
function labelColor(l: LabelRow): string {
  return l.hex ?? `var(--wp-var-${l.color})`;
}
/** A grouped toggle wears its label's colour on its left edge. */
function groupColorOf(t: ToggleRow): string | undefined {
  const l = groups.value.find((x) => x.toggles.some((y) => y.id === t.id))?.label;
  return l ? labelColor(l) : undefined;
}

/* ── labels ───────────────────────────────────────────────────────────── */

/** The colour picker's value for a label: its own pick, else the swatch it
 *  wears now, so the picker opens on the colour you see. */
function labelPickerValue(l: LabelRow): string {
  if (l.hex) return l.hex;
  const el = root.value;
  const v = el ? getComputedStyle(el).getPropertyValue(`--wp-var-${l.color}`).trim() : "";
  return v || "none";
}
function setLabelColor(l: LabelRow, v: string): void {
  patchLabel(l.id, { hex: /^#[0-9a-f]{6}$/i.test(v.slice(0, 7)) ? v.slice(0, 7).toLowerCase() : undefined });
}
function onCount(g: ToggleGroup): number {
  return g.toggles.filter((t) => eff.value.get(t.id)).length;
}
/** Output names a folded label shows the dots of. */
function foldedOuts(g: ToggleGroup): string | undefined {
  if (!g.label?.collapsed) return undefined;
  const names = g.toggles.filter((t) => t.pin && t.out).map((t) => `toggle_${t.out}`);
  return names.length ? names.join(" ") : undefined;
}

</script>

<template>
  <div ref="root" class="wp-tg" :class="{ 'wp-tg--skipped': isSkipped, 'wp-tg--edit': editMode }">
    <div v-if="editMode" class="wp-tg__bar">
      <WpSegmented
        :model-value="cfg.mode"
        :options="MODES"
        size="sm"
        aria-label="How toggles combine"
        test-prefix="tg-mode"
        @update:model-value="setMode"
      />
      <label v-if="isOne" class="wp-tg__group">
        <span class="wp-tg__group-cap">writes</span>
        <Input
          size="sm"
          mono
          prefix="$"
          class="wp-tg__group-var"
          :class="cfg.group_var ? varColorClass(cfg.group_var) : undefined"
          :tone="problems.has('group') ? 'warn' : undefined"
          :model-value="cfg.group_var"
          placeholder="picked (optional)"
          spellcheck="false"
          aria-label="Variable for the picked toggle's value"
          :title="problems.get('group') ?? 'Also write the picked toggle\'s value (or name) to this variable'"
          data-test="tg-group-var"
          @keydown.stop
          @change="setGroupVar"
        />
      </label>
      <span v-else class="wp-tg__spacer" />
      <Button variant="primary" size="sm" icon="pi-check" data-test="tg-edit-done" @click="closeEdit">Done</Button>
    </div>
    <div v-else-if="isOne" class="wp-tg__bar wp-tg__bar--clean">
      <span class="wp-tg__mode-cap">Pick one</span>
    </div>
    <div v-if="editMode && isOne" class="wp-tg__pickopts">
      <span v-tooltip="'Show the picked variable in the Assembler (else it is internal, for rules only)'" v-toggle-row class="wp-tg__check">
        <Checkbox
          :model-value="!!cfg.group_visible"
          size="sm"
          aria-label="Show in Assembler"
          data-test="tg-group-visible"
          @update:model-value="(v: boolean) => commit({ group_visible: v ? true : undefined })"
        />
        <span aria-hidden="true">Show in Assembler</span>
      </span>
      <span v-tooltip="'When the upstream Context holds the picked variable naming a toggle (its name or variable), that toggle is picked'" v-toggle-row class="wp-tg__check">
        <Checkbox
          :model-value="!!cfg.group_upstream"
          size="sm"
          aria-label="Upstream can pick"
          data-test="tg-group-upstream"
          @update:model-value="(v: boolean) => commit({ group_upstream: v ? true : undefined })"
        />
        <span aria-hidden="true">Upstream can pick</span>
      </span>
      <span class="wp-tg__pickstyle">
        <span class="wp-tg__mode-cap">Style</span>
        <WpSegmented
          :model-value="cfg.pick_style ?? 'radio'"
          :options="PICK_STYLE_OPTIONS"
          size="sm"
          aria-label="Pick one style"
          test-prefix="tg-pick-style"
          @update:model-value="(v: PickStyle) => commit({ pick_style: v === 'radio' ? undefined : v })"
        />
      </span>
    </div>

    <template v-for="g in groups" :key="g.label?.id ?? '__top'">
      <!-- Clean view: plain rows, no grips. -->
      <div v-if="!editMode" class="wp-tg__group-box">
        <div
          v-if="g.label"
          class="wp-tg__label"
          :style="{ color: labelColor(g.label) }"
          :data-wp-out="foldedOuts(g)"
          :data-test="`tg-label-${g.label.id}`"
        >
          <WpIconButton
            variant="bare"
            :icon="g.label.collapsed ? 'pi-caret-right' : 'pi-caret-down'"
            :label="g.label.collapsed ? 'Unfold' : 'Fold'"
            :data-test="`tg-fold-${g.label.id}`"
            @click="patchLabel(g.label.id, { collapsed: !g.label.collapsed })"
          />
          <i v-if="g.label.icon" class="pi wp-tg__label-icon" :class="`pi-${g.label.icon}`" aria-hidden="true" />
          <span class="wp-tg__label-text">{{ g.label.name || "Group" }}</span>
          <span class="wp-tg__rule" />
          <span class="wp-tg__count">{{ onCount(g) }}/{{ g.toggles.length }} on</span>
        </div>
        <template v-if="!g.label?.collapsed">
          <ToggleRowView
            v-for="item in g.toggles"
            :key="item.id"
            v-bind="rowProps(item)"
            @set-on="(v: boolean) => setOn(item, v)"
          />
        </template>
      </div>
    </template>

    <template v-if="editMode">
      <!-- One list for toggles and labels, so a toggle drags into or out of
           a group and a label drags with its toggles (`dragRow`). -->
      <SortableList
        v-if="shownRows.length"
        :model-value="shownRows"
        :item-key="(r: TogglesItem) => r.id"
        :item-label="(r: TogglesItem) => r.name || (r.kind === 'label' ? 'Group' : 'Toggle')"
        label="Toggles and labels"
        size="sm"
        class="wp-tg__list"
        @move="(m: { from: number; to: number }) => setRows(dragRow(cfg, m.from, m.to))"
      >
        <template #item="{ item }">
          <div
            v-if="item.kind === 'label'"
            class="wp-tg__label"
            :style="{ color: labelColor(item) }"
            :data-wp-out="foldedOuts(groupOfLabel(item))"
            :data-test="`tg-label-${item.id}`"
          >
            <WpIconButton
              variant="bare"
              :icon="item.collapsed ? 'pi-caret-right' : 'pi-caret-down'"
              :label="item.collapsed ? 'Unfold' : 'Fold'"
              :data-test="`tg-fold-${item.id}`"
              @click="patchLabel(item.id, { collapsed: !item.collapsed })"
            />
            <Input
              size="sm"
              class="wp-tg__label-name"
              :model-value="item.name"
              placeholder="Group name"
              spellcheck="false"
              aria-label="Group name"
              @keydown.stop
              @change="patchLabel(item.id, { name: ($event.target as HTMLInputElement).value.trim() })"
            />
            <span class="wp-tg__rule" />
            <span class="wp-tg__count">{{ groupOfLabel(item).toggles.length }}<template v-if="item.collapsed"> · {{ onCount(groupOfLabel(item)) }} on</template></span>
            <IconSwatch
              :model-value="item.icon ?? null"
              :color="labelColor(item)"
              aria-label="Group icon"
              :data-test="`tg-label-icon-${item.id}`"
              @update:model-value="(v: string | null) => patchLabel(item.id, { icon: v || undefined })"
            />
            <ColorField
              :model-value="labelPickerValue(item)"
              presets
              compact
              aria-label="Group colour"
              :data-test="`tg-color-${item.id}`"
              @update:model-value="(v: string) => setLabelColor(item, v)"
            />
            <WpIconButton
              icon="pi-times"
              tone="danger"
              label="Remove label"
              hint="Remove the label; its toggles join the group above"
              :data-test="`tg-label-remove-${item.id}`"
              @click="removeLabel(item)"
            />
          </div>
          <div
            v-else
            class="wp-tg__member"
            :class="{ 'is-grouped': groupColorOf(item) }"
            :style="groupColorOf(item) ? { '--wp-tg-group': groupColorOf(item) } : undefined"
          >
            <ToggleRowView
              v-bind="rowProps(item)"
              @set-on="(v: boolean) => setOn(item, v)"
              @patch="(p: Partial<ToggleRow>) => patchToggle(item.id, p)"
              @edit="toggleEdit(item)"
              @remove="removeToggle(item)"
            />
          </div>
        </template>
      </SortableList>

      <div v-if="!toggles.length" class="wp-tg__ghost">No toggles yet.</div>

      <div class="wp-tg__adds">
        <Button size="sm" variant="add" icon="pi-plus" block data-test="tg-add" @click="addToggle">Add toggle</Button>
        <Button size="sm" variant="add" icon="pi-tag" data-test="tg-add-label" @click="addLabel">Add label</Button>
      </div>
    </template>
    <div v-else-if="!toggles.length" class="wp-tg__ghost">No toggles yet: select the node and press the pencil above it.</div>
    <ToggleEditWindow
      v-if="editingRow"
      :key="editingRow.id"
      v-bind="windowProps(editingRow)"
      @done="(next: ToggleRow, groupId: string) => editingRow && applyWindow(editingRow, next, groupId)"
      @cancel="editing = null"
    />
  </div>
</template>

<style scoped>
.wp-tg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  padding: 4px 0;
  min-width: 0;
}
.wp-tg--skipped { opacity: 0.45; }
.wp-tg__bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-tg__bar--clean { min-height: 16px; margin-bottom: -2px; }
.wp-tg__spacer { flex: 1; }
.wp-tg__pickopts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 0 2px; }
.wp-tg__pickstyle { display: inline-flex; align-items: center; gap: 8px; flex-basis: 100%; }
.wp-tg__check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
.wp-tg__mode-cap { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tg__label-icon { font-size: 11px; }
.wp-tg__label-text {
  font: 600 11px var(--wp-font-sans, sans-serif);
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-tg__group { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.wp-tg__group .wp-tg__group-var { flex: 1 1 0; min-width: 80px; }
.wp-tg__group-cap { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
/* The sortable rows' own background would show behind our row cards. */
.wp-tg :deep(.wp-sortable__row) { background: transparent; align-items: flex-start; }
/* Edit view: every toggle and label row is one height (the subtitle and
 * the control line share a line), so a top-aligned grip of the same
 * height sits level with its row, also while the row's editor is open. */
.wp-tg :deep(.wp-sortable__grip) { align-self: flex-start; height: 38px; min-height: 38px; }
.wp-tg--edit :deep(.wp-tgr__row.wp-tgr__row) { min-height: 38px; }
.wp-tg--edit .wp-tg__label { min-height: 38px; }
.wp-tg__member.is-grouped { padding-left: 8px; border-left: 2px solid var(--wp-tg-group, var(--wp-border)); }
.wp-tg__group-box { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-tg__label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 2px;
  min-width: 0;
}
.wp-tg__label-name {
  flex: 0 1 auto;
  width: 12ch;
  min-width: 4ch;
  height: 22px;
  padding: 0 4px;
  background: transparent;
  color: inherit;
  border: 1px solid transparent;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: 600 11px var(--wp-font-sans, sans-serif);
  outline: none;
}
.wp-tg__label-name:hover { border-color: var(--wp-border); }
.wp-tg__label-name:focus { border-color: var(--wp-accent); background: var(--wp-bg-deep, var(--wp-bg)); }
.wp-tg__rule { flex: 1; height: 1px; background: currentColor; opacity: 0.25; }
.wp-tg__count { font: 10.5px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
.wp-tg__ghost {
  padding: 4px;
  font-size: 10.5px;
  font-style: italic;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-tg__adds { display: flex; gap: 6px; }
.wp-tg__adds > :first-child { flex: 1; }
</style>
