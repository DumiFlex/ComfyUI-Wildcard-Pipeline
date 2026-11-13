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
 * with its toggles (`dropToggleRow`); the edit panel's Group field moves one too.
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
import IconPicker from "@/kit/IconPicker.vue";
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
  dropToggleRow,
  type ToggleDropEdge,
  visibleRows,
  unfoldForVars,
} from "../../extension/toggles";
import { revealTarget } from "../../widgets/flash-target";
import { ctlInputName, type ControlState } from "../../extension/toggle-control";
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

const LAYOUTS = [
  { value: "rows", label: "Rows", icon: "pi-bars", hint: "One row per toggle" },
  { value: "grid", label: "Grid", icon: "pi-th-large", hint: "Tiles that wrap to the node's width; wired toggles get a line for their dots under the grid" },
];
/** The node's layout, the default for every group. */
const nodeLayout = computed(() => cfg.value.layout ?? "rows");
/** Clean view as a grid of tiles (both modes): the group's own layout, else
 *  the node's. */
function isGrid(g: ToggleGroup): boolean {
  return (g.label?.layout ?? nodeLayout.value) === "grid";
}
/** A group's layout; picking the node's own clears it, so it follows the
 *  node again. */
function setGroupLayout(l: LabelRow, v: string): void {
  patchLabel(l.id, { layout: v === nodeLayout.value ? undefined : v === "grid" ? "grid" : "rows" });
}
/** One socket line under a grid: the toggles with a control dot stack on
 *  the left, the ones with a BOOLEAN output on the right, each side packed
 *  on its own, so a line can carry two different toggles' dots. */
interface SockLine { left: ToggleRow | undefined; right: ToggleRow | undefined }
function sockPairs(g: ToggleGroup): SockLine[] {
  const lefts = g.toggles.filter((t) => t.control);
  const rights = g.toggles.filter((t) => t.pin && t.out);
  return Array.from({ length: Math.max(lefts.length, rights.length) }, (_, i) => ({ left: lefts[i], right: rights[i] }));
}
/** Its socket lines are merged into one (needs two or more). */
function isMerged(g: ToggleGroup): boolean {
  return (g.label ? !!g.label.sockets_merged : !!cfg.value.sockets_merged) && sockPairs(g).length > 1;
}
/** Merged line: a count per side ("3 in", "4 out"), the names in its
 *  tooltip, so many wires don't crowd the line. */
function sockSide(g: ToggleGroup, side: "in" | "out"): ToggleRow[] {
  return g.toggles.filter((t) => (side === "in" ? !!t.control : !!(t.pin && t.out)));
}
function sockCount(g: ToggleGroup, side: "in" | "out"): string {
  const n = sockSide(g, side).length;
  return n ? `${n} ${side}` : "";
}
function sockNames(g: ToggleGroup, side: "in" | "out"): string {
  return sockSide(g, side).map((t) => t.name).join(", ");
}
/** The control icon shown beside a left name. */
function ctlIcon(t: ToggleRow): string {
  return props.controls[t.id]?.control === "mute" ? "pi-volume-off" : "pi-forward";
}
/** The toggles that need a socket line under the grid: a control dot on the
 *  left or a BOOLEAN output on the right, each level with its name. */
function socketLines(g: ToggleGroup): ToggleRow[] {
  return g.toggles.filter((t) => t.control || (t.pin && t.out));
}
/** Merged: one line carries every wired choice's dots (row-outputs and
 *  field-sockets both read space-separated names), so the wires meet on one
 *  line until it is opened again. */
function mergedOuts(lines: ToggleRow[]): string | undefined {
  const names = lines.filter((t) => t.pin && t.out).map((t) => `toggle_${t.out}`);
  return names.length ? names.join(" ") : undefined;
}
function mergedSockets(lines: ToggleRow[]): string | undefined {
  const names = lines.filter((t) => t.control).map((t) => ctlInputName(t.id));
  return names.length ? names.join(" ") : undefined;
}
function toggleMerged(g: ToggleGroup): void {
  if (g.label) patchLabel(g.label.id, { sockets_merged: g.label.sockets_merged ? undefined : true });
  else commit({ sockets_merged: cfg.value.sockets_merged ? undefined : true });
}

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
    // Always one on: the picked toggle only goes off by picking another.
    if (!on && cfg.value.pick_required) return;
    setRows(cfg.value.rows.map((r) => (r.kind === "toggle" ? { ...r, on: r.id === t.id ? on : false } : r)));
  } else {
    patchToggle(t.id, { on });
  }
}
/** Always one on: turning it on with nothing on switches the first toggle on,
 *  so what the node shows and what it saves agree. */
function setPickRequired(v: boolean): void {
  if (!v) {
    commit({ pick_required: undefined });
    return;
  }
  const toggles = toggleRows(cfg.value);
  const first = toggles[0];
  const rows = first && !toggles.some((x) => x.on)
    ? cfg.value.rows.map((r) => (r.kind === "toggle" && r.id === first.id ? { ...r, on: true } : r))
    : cfg.value.rows;
  commit({ rows, pick_required: true });
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
  setRows(rowsOf(groupsOf({ ...cfg.value, rows: cfg.value.rows.filter((r) => r.id !== l.id) })));
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
  // One "no group" choice, however many runs of loose toggles there are.
  return groups.value
    .filter((g, i) => g.label || i === 0)
    .map((g) => ({ value: g.label?.id ?? "", label: g.label ? (g.label.name || "Group") : "No label (top)" }));
}
function groupIdOf(t: ToggleRow): string {
  return groups.value.find((g) => g.toggles.some((x) => x.id === t.id))?.label?.id ?? "";
}
/* ── ordering ─────────────────────────────────────────────────────────── */

type LabelledGroup = ToggleGroup & { label: LabelRow };
const labelled = computed(() => groups.value.filter((g): g is LabelledGroup => g.label !== null));
/** The edit view's rows: labels and the toggles of unfolded groups. */
const shownRows = computed(() => visibleRows(cfg.value));
/** A group's key: its label's id; `top` for the toggles above the first
 *  label, and `loose-<first toggle>` for a run dropped below a group. */
function groupKey(g: ToggleGroup, i: number): string {
  return g.label?.id ?? (i === 0 ? "top" : `loose-${g.toggles[0]?.id ?? i}`);
}
/** Where an edit-view drag would land, as the kit list asks it: no line
 *  when it can't land there; inside a group the line is indented and wears
 *  the group's colour, below a group it spans the row. */
function dropPlanFor(d: { from: number; over: number; edge: ToggleDropEdge }) {
  const from = shownRows.value[d.from];
  const over = shownRows.value[d.over];
  return from && over ? dropToggleRow(cfg.value, from.id, over.id, d.edge) : null;
}
function dropLineFor(d: { from: number; over: number; edge: ToggleDropEdge }): { inset?: number; color?: string } | boolean {
  const plan = dropPlanFor(d);
  if (!plan) return false;
  const moved = shownRows.value[d.from];
  return plan.group && moved?.kind === "toggle" ? { inset: 22, color: labelColor(plan.group) } : true;
}
function onDrop(d: { from: number; over: number; edge: ToggleDropEdge }): void {
  const plan = dropPlanFor(d);
  if (plan) setRows(plan.rows);
}
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
/** WP Debug "Show node": unfold the label groups that hide its toggle. */
function onReveal(ev: Event): void {
  const rows = unfoldForVars(cfg.value, revealTarget(ev)?.vars ?? []);
  if (rows) setRows(rows);
}
function onCount(g: ToggleGroup): number {
  return g.toggles.filter((t) => eff.value.get(t.id)).length;
}
/** Control input names a folded label shows the dots of, so they stay level
 *  with the group instead of stacking at the node's top. */
function foldedSockets(g: ToggleGroup): string | undefined {
  if (!g.label?.collapsed) return undefined;
  const names = g.toggles.filter((t) => t.control).map((t) => ctlInputName(t.id));
  return names.length ? names.join(" ") : undefined;
}
/** Output names a folded label shows the dots of. */
function foldedOuts(g: ToggleGroup): string | undefined {
  if (!g.label?.collapsed) return undefined;
  const names = g.toggles.filter((t) => t.pin && t.out).map((t) => `toggle_${t.out}`);
  return names.length ? names.join(" ") : undefined;
}

</script>

<template>
  <div ref="root" class="wp-tg" data-wp-reveal :class="{ 'wp-tg--skipped': isSkipped, 'wp-tg--edit': editMode }" @wp-reveal="onReveal">
    <div v-if="editMode" class="wp-tg__bar">
      <WpSegmented
        :model-value="cfg.mode"
        :options="MODES"
        size="sm"
        aria-label="How toggles combine"
        test-prefix="tg-mode"
        @update:model-value="setMode"
      />
      <label v-if="isOne" class="wp-tg__group" :data-wp-vars="cfg.group_var || undefined">
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
      <WpSegmented
        :model-value="cfg.layout ?? 'rows'"
        :options="LAYOUTS"
        size="sm"
        icon-only
        aria-label="Layout"
        test-prefix="tg-layout"
        @update:model-value="(v: string) => commit({ layout: v === 'grid' ? 'grid' : undefined })"
      />
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
      <span v-tooltip="'Like radio buttons: one toggle is always on. Clicking the picked one does nothing; pick another to switch. With none on, the first toggle is picked'" v-toggle-row class="wp-tg__check">
        <Checkbox
          :model-value="!!cfg.pick_required"
          size="sm"
          aria-label="Always one on"
          data-test="tg-pick-required"
          @update:model-value="setPickRequired"
        />
        <span aria-hidden="true">Always one on</span>
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

    <template v-for="(g, gi) in groups" :key="groupKey(g, gi)">
      <!-- Clean view: plain rows, no grips. -->
      <div v-if="!editMode" class="wp-tg__group-box">
        <div
          v-if="g.label"
          class="wp-tg__label"
          :style="{ color: labelColor(g.label) }"
          :data-wp-out="foldedOuts(g)"
          :data-wp-socket="foldedSockets(g)"
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
        <template v-if="!g.label?.collapsed && isGrid(g) && g.toggles.length">
          <div class="wp-tg__grid" data-test="tg-grid">
            <ToggleRowView
              v-for="item in g.toggles"
              :key="item.id"
              v-bind="rowProps(item)"
              :indent="0"
              tile
              @set-on="(v: boolean) => setOn(item, v)"
            />
          </div>
          <div
            v-if="isMerged(g)"
            class="wp-tg__sockline is-on"
            :data-wp-out="mergedOuts(socketLines(g))"
            :data-wp-socket="mergedSockets(socketLines(g))"
            :data-test="`tg-sockmerged-${groupKey(g, gi)}`"
          >
            <span class="wp-tg__sockpad"><WpIconButton variant="bare" icon="pi-caret-right" label="Show each toggle's wires" data-test="tg-sock-expand" @click="toggleMerged(g)" /></span>
            <span v-tooltip="sockNames(g, 'in')" class="wp-tg__sockname">{{ sockCount(g, "in") }}</span>
            <span v-tooltip="sockNames(g, 'out')" class="wp-tg__sockname is-right">{{ sockCount(g, "out") }}</span>
          </div>
          <div
            v-for="(line, i) in isMerged(g) ? [] : sockPairs(g)"
            :key="i"
            class="wp-tg__sockline"
            :data-wp-out="line.right ? `toggle_${line.right.out}` : undefined"
            :data-wp-socket="line.left ? ctlInputName(line.left.id) : undefined"
            :data-test="`tg-sockline-${groupKey(g, gi)}-${i}`"
          >
            <!-- One caret column for every line, so the names line up. -->
            <span v-if="sockPairs(g).length > 1" class="wp-tg__sockpad">
              <WpIconButton v-if="i === 0" variant="bare" icon="pi-caret-down" label="Merge the wires onto one line" data-test="tg-sock-merge" @click="toggleMerged(g)" />
            </span>
            <span class="wp-tg__sockname" :class="{ 'is-on': line.left && !!eff.get(line.left.id) }">
              <template v-if="line.left">
                {{ line.left.name }}
                <i
                  v-if="controls[line.left.id]"
                  v-tooltip="controls[line.left.id]?.hint"
                  class="pi wp-tg__sockctl"
                  :class="[ctlIcon(line.left), `is-${controls[line.left.id]?.control}`, { 'is-active': controls[line.left.id]?.active }]"
                  role="img"
                  :aria-label="controls[line.left.id]?.hint"
                />
              </template>
            </span>
            <span class="wp-tg__sockname is-right" :class="{ 'is-on': line.right && !!eff.get(line.right.id) }">{{ line.right?.name }}</span>
          </div>
        </template>
        <template v-else-if="!g.label?.collapsed">
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
      <!-- One list for toggles and labels, so a toggle drags into, out of or
           below a group and a label drags with its toggles (`dropToggleRow`). -->
      <SortableList
        v-if="shownRows.length"
        :model-value="shownRows"
        :item-key="(r: TogglesItem) => r.id"
        :item-label="(r: TogglesItem) => r.name || (r.kind === 'label' ? 'Group' : 'Toggle')"
        label="Toggles and labels"
        size="sm"
        class="wp-tg__list"
        end-zone
        :drop-line="dropLineFor"
        @drop="onDrop"
      >
        <template #item="{ item }">
          <div
            v-if="item.kind === 'label'"
            class="wp-tg__label"
            :style="{ color: labelColor(item) }"
            :data-wp-out="foldedOuts(groupOfLabel(item))"
            :data-wp-socket="foldedSockets(groupOfLabel(item))"
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
            <IconPicker
              :model-value="item.icon ?? null"
              all
              compact
              size="sm"
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
              icon="pi-th-large"
              :pressed="(item.layout ?? nodeLayout) === 'grid'"
              label="Show this group as a grid"
              hint="Grid: this group's toggles as tiles that wrap to the node's width. Off: one row each."
              :data-test="`tg-glayout-${item.id}`"
              @click="setGroupLayout(item, (item.layout ?? nodeLayout) === 'grid' ? 'rows' : 'grid')"
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
/* Grid layout: each tile is as wide as what it shows (name, var, control),
 * tiles wrap to the node's width, never resize it, and the tiles in a line
 * grow to fill it, so nothing is cut short or stretched to two columns. */
.wp-tg__grid {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
}
.wp-tg__grid > .wp-tgr { flex: 1 1 auto; min-width: 96px; max-width: 100%; }
/* Grid: a thin line under the tiles per wired toggle, so its control dot
 * (left) and BOOLEAN output (right) sit level with its name. */
.wp-tg__sockline {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  /* Left like a label row, so the merge caret sits under a group's fold
   * caret. */
  padding: 0 8px 0 2px;
  font-size: 11px;
  color: var(--wp-text-dim, var(--wp-text3));
  min-width: 0;
}
.wp-tg__sockline.is-on, .wp-tg__sockname.is-on { color: var(--wp-text-muted, var(--wp-text2)); }
.wp-tg__sockname.is-right { text-align: right; }
.wp-tg__sockname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-tg__sockctl { font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
/* Keeps every name level with the first line's, which holds the caret. */
.wp-tg__sockpad { flex: none; width: 14px; display: inline-flex; align-items: center; justify-content: center; }
/* Same colours as the row's control icon (ToggleRow). */
.wp-tg__sockctl.is-active { opacity: 1; }
.wp-tg__sockctl.is-active.is-bypass { color: var(--wp-violet); }
.wp-tg__sockctl.is-active.is-mute { color: var(--wp-amber, var(--wp-warn)); }
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
