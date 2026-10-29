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
 * pencil at the top opens the edit view (mode, grips, row editors, add
 * buttons) and Done closes it. A node with no toggles opens in the edit view.
 * The view is per session, never saved.
 *
 * Toggles belong to the label above them. Labels move with their toggles
 * (outer list), toggles move inside their group (inner lists); the edit
 * panel's Group field moves one to another label.
 *
 * Value contract: `modelValue` is a `TogglesConfig`; every edit emits the
 * whole next config (`src/widgets/toggles.ts` fits the outputs to it).
 */
import { computed, nextTick, ref } from "vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import SortableList from "../../kit/SortableList.vue";
import WpCheck from "../../kit/WpCheck.vue";
import { vTooltip } from "../../kit/tooltip";
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
} from "../../extension/toggles";

const props = withDefaults(
  defineProps<{
    modelValue: TogglesConfig;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Toggle id → what its mute / bypass control drives. */
    controls?: Record<string, string>;
    /** Canvas group titles, for the control's group picker. */
    canvasGroups?: string[];
  }>(),
  { nodeMode: 0, controls: () => ({}), canvasGroups: () => [] },
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

async function focusEditor(): Promise<void> {
  await nextTick();
  root.value?.querySelector<HTMLInputElement>(".wp-tgr__edit input")?.select();
}

function addToggle(): void {
  const t = newToggle(cfg.value);
  if (pinCount.value >= MAX_OUTPUTS) t.pin = false;
  setRows([...cfg.value.rows, t]);
  editing.value = t.id;
  void focusEditor();
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

function rename(t: ToggleRow, raw: string): void {
  const name = raw.trim() || t.name;
  // A variable that still follows the old name follows the new one.
  const follows = !t.var || t.var === uniqueVar(varFromName(t.name), cfg.value, t.id);
  const v = follows ? uniqueVar(varFromName(name) || t.var, cfg.value, t.id) : t.var;
  patchToggle(t.id, { name, var: v });
}
function setVar(t: ToggleRow, v: string): void {
  patchToggle(t.id, { var: v });
}
function toggleEdit(t: ToggleRow): void {
  editing.value = editing.value === t.id ? null : t.id;
  if (editing.value) void focusEditor();
}
function rowProps(t: ToggleRow) {
  const p = parentOf(t);
  return {
    t,
    pickOne: isOne.value,
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
    controlText: props.controls[t.id] ?? "",
    canvasGroups: props.canvasGroups,
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
/** Move a toggle to the end of another label's group. */
function moveToGroup(t: ToggleRow, labelId: string): void {
  const next: ToggleGroup[] = groups.value.map((g) => ({ label: g.label, toggles: g.toggles.filter((x) => x.id !== t.id) }));
  const target = next.find((g) => (g.label?.id ?? "") === labelId);
  if (!target) return;
  target.toggles.push(t);
  if (target.label?.collapsed) target.label = { ...target.label, collapsed: false };
  setRows(rowsOf(next));
}

/* ── ordering ─────────────────────────────────────────────────────────── */

type LabelledGroup = ToggleGroup & { label: LabelRow };
const labelled = computed(() => groups.value.filter((g): g is LabelledGroup => g.label !== null));
const top = computed(() => groups.value[0]);

function reorderGroups(next: ToggleGroup[]): void {
  setRows(rowsOf([top.value, ...next]));
}
function reorderToggles(group: ToggleGroup, next: ToggleRow[]): void {
  setRows(rowsOf(groups.value.map((g) => (g === group ? { ...g, toggles: next } : g))));
}

/* ── labels ───────────────────────────────────────────────────────────── */

function nextColor(l: LabelRow): void {
  patchLabel(l.id, { color: (l.color % 8) + 1 });
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
        <input
          class="wp-tg__group-var"
          :class="[cfg.group_var ? varColorClass(cfg.group_var) : undefined, { 'is-problem': problems.has('group') }]"
          :value="cfg.group_var ? `$${cfg.group_var}` : ''"
          placeholder="$picked (optional)"
          spellcheck="false"
          aria-label="Variable for the picked toggle's name"
          :title="problems.get('group') ?? 'Also write the picked toggle\'s name to this variable'"
          data-test="tg-group-var"
          @keydown.stop
          @change="setGroupVar"
        >
      </label>
      <span v-else class="wp-tg__spacer" />
      <WpButton variant="primary" size="sm" icon="pi-check" data-test="tg-edit-done" @click="closeEdit">Done</WpButton>
    </div>
    <div v-if="editMode && isOne" class="wp-tg__pickopts">
      <span v-tooltip="'Print the picked variable in the prompt (else it is for rules only)'" class="wp-tg__check">
        <WpCheck
          :model-value="!!cfg.group_visible"
          size="sm"
          aria-label="Show in prompt"
          data-test="tg-group-visible"
          @update:model-value="(v: boolean) => commit({ group_visible: v ? true : undefined })"
        />
        <span aria-hidden="true">Show in prompt</span>
      </span>
      <span v-tooltip="'When the upstream Context holds the picked variable naming a toggle (its name or variable), that toggle is picked'" class="wp-tg__check">
        <WpCheck
          :model-value="!!cfg.group_upstream"
          size="sm"
          aria-label="Upstream can pick"
          data-test="tg-group-upstream"
          @update:model-value="(v: boolean) => commit({ group_upstream: v ? true : undefined })"
        />
        <span aria-hidden="true">Upstream can pick</span>
      </span>
    </div>
    <div v-else class="wp-tg__bar wp-tg__bar--clean">
      <span class="wp-tg__mode-cap">{{ isOne ? "Pick one" : "" }}</span>
      <WpIconButton
        icon="pi-pencil"
        label="Edit toggles"
        hint="Edit toggles: add, rename, reorder, outputs"
        data-test="tg-edit-open"
        @click="openEdit"
      />
    </div>

    <template v-for="g in groups" :key="g.label?.id ?? '__top'">
      <!-- Clean view: plain rows, no grips. -->
      <div v-if="!editMode" class="wp-tg__group-box">
        <div
          v-if="g.label"
          class="wp-tg__label"
          :class="`var-${g.label.color}`"
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
      <SortableList
        v-if="top.toggles.length"
        :model-value="top.toggles"
        :item-key="(t: ToggleRow) => t.id"
        :item-label="(t: ToggleRow) => t.name"
        label="Toggles"
        size="sm"
        class="wp-tg__list"
        @update:model-value="(v: ToggleRow[]) => reorderToggles(top, v)"
      >
        <template #item="{ item }">
          <ToggleRowView
            v-bind="rowProps(item)"
            @set-on="(v: boolean) => setOn(item, v)"
            @patch="(p: Partial<ToggleRow>) => patchToggle(item.id, p)"
            @rename="(n: string) => rename(item, n)"
            @set-var="(v: string) => setVar(item, v)"
            @edit="toggleEdit(item)"
            @move-group="(id: string) => moveToGroup(item, id)"
            @remove="removeToggle(item)"
          />
        </template>
      </SortableList>

      <SortableList
        v-if="labelled.length"
        :model-value="labelled"
        :item-key="(g: LabelledGroup) => g.label.id"
        :item-label="(g: LabelledGroup) => g.label.name || 'Group'"
        label="Groups"
        size="sm"
        class="wp-tg__groups"
        @update:model-value="reorderGroups"
      >
        <template #item="{ item: g }">
          <div class="wp-tg__group-box">
            <div
              class="wp-tg__label"
              :class="`var-${g.label.color}`"
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
              <input
                class="wp-tg__label-name"
                :value="g.label.name"
                placeholder="Group name"
                spellcheck="false"
                aria-label="Group name"
                @keydown.stop
                @change="patchLabel(g.label.id, { name: ($event.target as HTMLInputElement).value.trim() })"
              >
              <span class="wp-tg__rule" />
              <span class="wp-tg__count">{{ g.toggles.length }}<template v-if="g.label.collapsed"> · {{ onCount(g) }} on</template></span>
              <WpIconButton
                icon="pi-palette"
                :label="`Colour ${g.label.color} of 8`"
                hint="Next colour"
                :data-test="`tg-color-${g.label.id}`"
                @click="nextColor(g.label)"
              />
              <WpIconButton
                icon="pi-times"
                tone="danger"
                label="Remove label"
                hint="Remove the label; its toggles join the group above"
                :data-test="`tg-label-remove-${g.label.id}`"
                @click="removeLabel(g.label)"
              />
            </div>
            <SortableList
              v-if="!g.label.collapsed && g.toggles.length"
              :model-value="g.toggles"
              :item-key="(t: ToggleRow) => t.id"
              :item-label="(t: ToggleRow) => t.name"
              :label="g.label.name || 'Group'"
              size="sm"
              class="wp-tg__list"
              @update:model-value="(v: ToggleRow[]) => reorderToggles(g, v)"
            >
              <template #item="{ item }">
                <ToggleRowView
                  v-bind="rowProps(item)"
                  @set-on="(v: boolean) => setOn(item, v)"
                  @patch="(p: Partial<ToggleRow>) => patchToggle(item.id, p)"
                  @rename="(n: string) => rename(item, n)"
                  @set-var="(v: string) => setVar(item, v)"
                  @edit="toggleEdit(item)"
                  @move-group="(id: string) => moveToGroup(item, id)"
                  @remove="removeToggle(item)"
                />
              </template>
            </SortableList>
            <div v-else-if="!g.label.collapsed" class="wp-tg__ghost">Empty group: pick it in a toggle's Group field.</div>
          </div>
        </template>
      </SortableList>

      <div v-if="!toggles.length" class="wp-tg__ghost">No toggles yet.</div>

      <div class="wp-tg__adds">
        <WpButton variant="add" icon="pi-plus" block data-test="tg-add" @click="addToggle">Add toggle</WpButton>
        <WpButton variant="add" icon="pi-tag" data-test="tg-add-label" @click="addLabel">Add label</WpButton>
      </div>
    </template>
    <div v-else-if="!toggles.length" class="wp-tg__ghost">No toggles yet: click the pencil to add some.</div>
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
.wp-tg__bar--clean { justify-content: space-between; min-height: 20px; margin-bottom: -2px; }
.wp-tg__spacer { flex: 1; }
.wp-tg__pickopts { display: flex; gap: 12px; padding: 0 2px; }
.wp-tg__check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
.wp-tg__mode-cap { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tg__label-text {
  font: 600 11px var(--wp-font-sans, sans-serif);
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-tg__group { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.wp-tg__group-cap { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tg__group-var {
  flex: 1;
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 8px;
  box-sizing: border-box;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: 11px var(--wp-font-mono, monospace);
  outline: none;
}
.wp-tg__group-var:not([class*="var-"]) { color: var(--wp-text); }
.wp-tg__group-var:focus { border-color: var(--wp-accent); }
.wp-tg__group-var.is-problem { border-color: var(--wp-amber, var(--wp-warn)); }
/* The sortable rows' own background would show behind our row cards. */
.wp-tg :deep(.wp-sortable__row) { background: transparent; align-items: flex-start; }
.wp-tg :deep(.wp-sortable__grip) { align-self: flex-start; min-height: 32px; }
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
