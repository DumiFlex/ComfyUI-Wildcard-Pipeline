<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  emptyInjectorRowsValue,
  newRowUid,
  parseWidgetJsonWithRecovery,
  serializeWidgetJson,
  type InjectorRow,
  type InjectorRowsValue,
} from "../../widgets/_shared";
import { reorderInjectorRows } from "../../widgets/injector";
import { shortConflictLabel, scanInjectorConflicts } from "../../extension/conflicts";
import { applyFlip, captureRects, MOTION_FLIP_MS } from "../shared/flip";
import InjectorRowComp from "./InjectorRow.vue";
import ContextMenu, { type ContextMenuItem } from "../shared/ContextMenu.vue";
import InjectorBindingModal from "./InjectorBindingModal.vue";

// NOTE: when we wire enter/leave animations (row added on connect,
// row removed on disconnect) we'll pass `{ classes: INJ_ANIM_CLASSES }`
// into withEnterAnimation / withLeaveAnimation. Reserved for that
// future commit:
//   const INJ_ANIM_CLASSES: AnimationClasses = {
//     arriving: "wp-inj-row--arriving",
//     arrived:  "wp-inj-row--arrived",
//     leaving:  "wp-inj-row--leaving",
//     flash:    "wp-inj-row--flash",
//   };
// The reorder path below uses applyFlip directly — it doesn't add
// any classes, just inverse-transforms each row from its old to new
// position, so the class vocabulary is irrelevant for this case.

const props = withDefaults(
  defineProps<{
    nodeId: number;
    initialJson: string;
    /** Names of `input_*` socket slots with a live wire on the node.
     *  Polled from the outer mount glue and reconciled into rows. */
    connectedSlots?: string[];
    /** Per-slot type label — `STRING` / `INT` / `FLOAT` / `BOOLEAN`. */
    slotTypes?: Record<string, string>;
    /** Per-slot display label keyed by slot_name (input_N). Holds the
     *  user-customized socket label when set; rows fall back to the
     *  slot_name when this map has no entry. Lets a renamed pin
     *  surface its label in the DOM row badge so the user can
     *  correlate row ↔ wire after renaming. */
    slotLabels?: Record<string, string>;
    /** Variables produced by anything upstream of this injector. Used
     *  by the conflict scanner to flag shadows_upstream when an
     *  injector binding overrides an upstream Context output. */
    upstreamVars?: string[];
    /** Litegraph node mode — 0=ALWAYS, 2=NEVER (mute), 4=BYPASS.
     *  Drives the dim overlay so muted/bypassed state reads at a
     *  glance, matching ContextWidget's pattern. */
    nodeMode?: number;
    /** Whether the input wires are visually collapsed onto a single
     *  pin. Drives the header button's icon + tooltip. State lives
     *  on `node.properties.collapse_connections` (managed by the
     *  outer mount glue via the shared collapse-connections helper)
     *  — this prop is the reactive read-side. */
    connectionsCollapsed?: boolean;
  }>(),
  { connectedSlots: () => [], slotTypes: () => ({}), slotLabels: () => ({}), upstreamVars: () => [], nodeMode: 0, connectionsCollapsed: false },
);

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const emit = defineEmits<{
  (e: "change", json: string): void;
  (e: "disconnect-slot", slotName: string): void;
  (e: "toggle-connections-collapse"): void;
  /** Fires whenever the formula-computed minimum node width changes —
   *  triggered by state shifts that add or remove row children
   *  (conflict badge appears, a row with a known type chip is added,
   *  rows are added/removed). Mount glue handles the value by
   *  updating its own minWidth getter and calling requestRelayout
   *  on the dom widget host. One-shot per state change; loop-free. */
  (e: "request-min-width", minWidth: number): void;
}>();

const value = ref<InjectorRowsValue>(
  parseWidgetJsonWithRecovery(props.initialJson, emptyInjectorRowsValue()).value,
);

watch(
  () => props.initialJson,
  (next) => {
    value.value = parseWidgetJsonWithRecovery(next, emptyInjectorRowsValue()).value;
  },
);

const enabledCount = computed(
  () => value.value.rows.filter((r) => r.enabled).length,
);

const connectedSet = computed(() => new Set(props.connectedSlots));

function isConnected(slotName: string): boolean {
  return connectedSet.value.has(slotName);
}

/** Per-row conflict map keyed by `_uid`. Recomputes from row state
 *  + connection set; warn-class + tooltip surface in InjectorRow. */
interface RowConflict {
  severity: "info" | "warning" | "error";
  label: string;
}

/** Per-row conflict info keyed by `_uid`. Picks highest severity if a
 *  row has multiple conflicts (warning > info; error reserved for
 *  future). Drives the `wp-conflict-dot--*` + `wp-conflict-badge--*`
 *  cluster in each row, matching ContextWidget's pattern. */
const conflictByUid = computed<Record<string, RowConflict>>(() => {
  const out: Record<string, RowConflict> = {};
  const conflicts = scanInjectorConflicts(
    value.value,
    props.connectedSlots ?? [],
    props.upstreamVars ?? [],
  );
  const rank: Record<RowConflict["severity"], number> = { info: 0, warning: 1, error: 2 };
  for (const c of conflicts) {
    const next: RowConflict = { severity: c.severity, label: shortConflictLabel(c.type) };
    const prev = out[c.moduleId];
    if (!prev || rank[next.severity] > rank[prev.severity]) out[c.moduleId] = next;
  }
  return out;
});

// ── Formula-driven minWidth ────────────────────────────────────────
// Mirror of CSS-defined widths for each row child. The formula sums
// only the children that are CURRENTLY rendered (based on state), so
// the node defaults to a smaller width when there are no conflicts /
// no type chips, and grows only when state demands it.
//
// Pull-based: createDomWidgetHost wires `() => requiredMinWidth.value`
// into widget.computeLayoutSize, which litegraph reads on every
// relayout. We don't push setSize; the parent (mount glue) does it
// via host.requestRelayout when this value changes.
//
// CSS source-of-truth dependencies (keep in lockstep):
//   .wp-inj-toggle, .wp-inj-toggle-mark
//   .wp-inj-type-icon       width 16
//   .wp-inj-slot            max-width 96
//   .wp-inj-type-chip       ~50 (font 9px × ~7 chars for "boolean")
//   .wp-vbind-wrap          min-width 80
//   .wp-conflict-dot        7
//   .wp-conflict-badge      max-width 88
//   .wp-inj-action          width 20 (× 2 in cluster)
//   .wp-inj-row             gap 6, padding 4px 6px, border 1 + border-left 3
//   .wp-inj-list            padding 6px 8px
//   .wp-inj-widget          border 1px
const ROW_PART = {
  TOGGLE: 16,
  TYPE_ICON: 16,
  SLOT_TAG_MAX: 96,
  TYPE_CHIP: 50,
  VBIND_MIN: 80,
  CONFLICT_DOT: 7,
  CONFLICT_BADGE_MAX: 88,
  ACTIONS_CLUSTER: 41,   // 2 buttons × 20px + 1px gap
  GAP: 6,
  ROW_PADDING_H: 12,     // 6 + 6
  ROW_BORDER: 4,         // 3 left + 1 right
  LIST_PADDING_H: 16,    // 8 + 8
  WIDGET_BORDER: 2,      // 1 + 1
} as const;

const hasAnyType = computed(() =>
  value.value.rows.some((r) => Boolean(props.slotTypes[r.slot_name])),
);
const hasAnyConflict = computed(() =>
  value.value.rows.some((r) => Boolean(conflictByUid.value[r._uid])),
);

const requiredMinWidth = computed(() => {
  const p = ROW_PART;
  // Always-present row children: toggle, type-icon, slot tag, vbind,
  // actions cluster. That's 5 flex children, 4 gaps between them.
  let sum = p.TOGGLE + p.TYPE_ICON + p.SLOT_TAG_MAX + p.VBIND_MIN + p.ACTIONS_CLUSTER;
  let childCount = 5;
  if (hasAnyType.value) {
    sum += p.TYPE_CHIP;
    childCount += 1;
  }
  if (hasAnyConflict.value) {
    sum += p.CONFLICT_DOT + p.CONFLICT_BADGE_MAX;
    childCount += 2;
  }
  sum += p.GAP * (childCount - 1);
  sum += p.ROW_PADDING_H + p.ROW_BORDER;
  sum += p.LIST_PADDING_H + p.WIDGET_BORDER;
  return sum;
});

// Emit on every change. `immediate: true` fires on mount so the
// mount glue gets the correct initial width without waiting for a
// state change. One-shot per state change — no loop because the
// watch deps only include reactive state, not DOM measurements.
watch(
  requiredMinWidth,
  (next) => {
    emit("request-min-width", next);
  },
  { immediate: true },
);

/** Collapse toggle — hides the rows list. Mirrors the per-module
 *  collapse pattern from ContextWidget where collapsing a row hides
 *  its summary. Persists in widget JSON via the same persist() so
 *  reload restores collapsed state. */
const collapsed = ref<boolean>(false);

function persist(): void {
  const serialized = serializeWidgetJson(value.value);
  emit("change", serialized);
}

// Debounce binding-only edits so persist() doesn't fire on every
// keystroke. 250ms timeout — short enough that disconnect / save
// shortly after typing still sees the latest binding (the timer
// fires well before any realistic graph mutation). Non-binding
// patches (enabled / internal toggle) persist immediately.
let bindingDebounce: number | null = null;
function updateRow(uid: string, patch: Partial<InjectorRow>): void {
  value.value = {
    ...value.value,
    rows: value.value.rows.map((r) => (r._uid === uid ? { ...r, ...patch } : r)),
  };
  const onlyBinding = Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, "binding");
  if (onlyBinding) {
    if (bindingDebounce != null) window.clearTimeout(bindingDebounce);
    bindingDebounce = window.setTimeout(() => {
      bindingDebounce = null;
      persist();
    }, 250);
  } else {
    if (bindingDebounce != null) {
      window.clearTimeout(bindingDebounce);
      bindingDebounce = null;
    }
    persist();
  }
}

function removeRow(uid: string): void {
  value.value = {
    ...value.value,
    rows: value.value.rows.filter((r) => r._uid !== uid),
  };
  persist();
}

function addRow(slotName: string): void {
  if (value.value.rows.some((r) => r.slot_name === slotName)) return;
  value.value = {
    ...value.value,
    rows: [
      ...value.value.rows,
      {
        _uid: newRowUid(),
        slot_name: slotName,
        binding: "",
        enabled: true,
        internal: false,
      },
    ],
  };
  persist();
}

// Reconcile rows array against the polled `connectedSlots` prop.
// Adds rows for newly-connected slots; auto-removes rows whose slots
// have been severed. (Earlier design kept severed rows with a warn
// badge; user feedback flipped it to auto-cleanup since the row is
// useless without a wire and re-creating it is just re-connecting.)
//
// C.1b note: read rows from `props.initialJson` (latest source-of-
// truth) rather than `value.value.rows` (potentially stale). When
// the slot reindexer in injector.ts mutates socket names AND row
// JSON in the same tick, this watcher and the initialJson watcher
// can race — if connectedSlots fires first, value.value.rows still
// holds the pre-rename state and we'd false-positive every row as
// severed. Parsing initialJson here breaks the race.
function slotOrderIndex(slotName: string): number {
  const m = slotName.match(/^input_(\d+)$/);
  return m ? parseInt(m[1], 10) : 999;
}

watch(
  () => props.connectedSlots,
  (next) => {
    const freshRows = parseWidgetJsonWithRecovery(props.initialJson, emptyInjectorRowsValue()).value.rows;
    const connectedSet = new Set(next);
    const known = new Set(freshRows.map((r) => r.slot_name));
    const toAdd = next.filter((slot) => !known.has(slot));
    const survivors = freshRows.filter((r) => connectedSet.has(r.slot_name));
    const removed = survivors.length !== freshRows.length;
    if (toAdd.length === 0 && !removed) return;
    value.value = {
      ...value.value,
      rows: [
        ...survivors,
        ...toAdd.map((slot) => ({
          _uid: newRowUid(),
          slot_name: slot,
          binding: "",
          enabled: true,
          internal: false,
        })),
      // Always order rows by slot index so the visual list matches
      // the socket pin order on the node body, regardless of when
      // each row was added (toAdd appends at end; without this sort
      // a newly-connected lower-numbered slot would render below
      // already-known higher-numbered rows).
      ].sort((a, b) => slotOrderIndex(a.slot_name) - slotOrderIndex(b.slot_name)),
    };
    persist();
  },
  { immediate: true },
);

// ── Drag-to-reorder. Persists the new row order with sequential
// slot_name reassignment (reorderInjectorRows): the wire at each
// physical input_N socket then feeds whatever variable now sits at
// that index. dragSrcIdx is captured on dragstart and cleared on
// drop / dragend so a cancelled drag doesn't leak state.
//
// FLIP animation: captureRects BEFORE the row mutation snapshots
// each row's current Y position keyed by `data-uid`. After Vue
// re-renders the new order (nextTick), applyFlip computes the
// inverse-transform per row and tweens back to identity — the rows
// appear to slide to their new positions instead of jump-cutting.
// shared/flip.ts honors the wp-a11y-no-motion body class so the
// animation no-ops under reduce-motion settings.
const dragSrcIdx = ref<number | null>(null);
const listEl = ref<HTMLElement | null>(null);

// Parent-coordinated drop indicator. Tracks the row + edge the
// pointer is currently over so only ONE row shows the gap+bar
// indicator at a time. Per-row local state would race: HTML5 fires
// the previous row's dragleave AFTER the new row's dragenter, so a
// brief frame can have two rows showing indicators. Lifting here
// gives a single source: each row emits row-drag-over on its own
// dragover; we just overwrite the target.
const dragOverUid = ref<string | null>(null);
const dragOverEdge = ref<"before" | "after" | null>(null);
function dropIndicatorFor(uid: string): "before" | "after" | null {
  return uid === dragOverUid.value ? dragOverEdge.value : null;
}
function clearDropIndicator(): void {
  dragOverUid.value = null;
  dragOverEdge.value = null;
}
/** UIDs of rows that just landed via drag-drop. Template binds the
 *  `.wp-drop-pulse` class while a UID is present; entries clear after
 *  the keyframe duration (420ms in shared/row-primitives.css). */
const recentDropUids = ref<Set<string>>(new Set());
const DROP_PULSE_MS = 420;

function onRowDragStart(fromIdx: number): void {
  dragSrcIdx.value = fromIdx;
}

// List-level dragover. Tracking at LIST level (not per-row) so the
// drop-target stays stable when individual rows shift by margin-top
// /bottom (the slot opens via `.wp-inj-row--drop-before/after`
// rules). Per-row dragover ran into oscillation: row 2 dragover
// opens its top gap → row 2 shifts down → pointer now sits in the
// gap above row 2 → row 1's dragover fires → row 1 opens its
// bottom gap → row 1 shifts down → flip-flop. List-level handler
// reads pointer Y vs each row's rect once, so shifts inside the
// list don't change the target computation. Mirrors
// ContextWidget.onListDragOver.
function onListDragOver(ev: DragEvent): void {
  if (dragSrcIdx.value === null) return;
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  const list = listEl.value;
  if (!list) return;
  const rows = Array.from(list.querySelectorAll<HTMLElement>(".wp-inj-row[data-uid]"));
  let targetUid: string | null = null;
  let edge: "before" | "after" | null = null;
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    if (ev.clientY <= r.top + r.height / 2) {
      targetUid = el.dataset.uid ?? null;
      edge = "before";
      break;
    }
    if (ev.clientY < r.bottom) {
      targetUid = el.dataset.uid ?? null;
      edge = "after";
      break;
    }
  }
  if (!targetUid && rows.length > 0) {
    // Pointer past all rows → drop at end (after last row).
    const lastEl = rows[rows.length - 1];
    targetUid = lastEl.dataset.uid ?? null;
    edge = "after";
  }
  if (targetUid && edge) {
    if (dragOverUid.value !== targetUid) dragOverUid.value = targetUid;
    if (dragOverEdge.value !== edge) dragOverEdge.value = edge;
  }
}

// List-level drop. Reads the last-tracked target from state instead
// of recomputing from the drop event's clientY — by the time drop
// fires, the gap may have already opened (margin shifted the rows),
// so the pointer Y at drop time can pick a different target than
// the visual indicator showed during dragover. Trust the indicator.
function onListDrop(ev: DragEvent): void {
  ev.preventDefault();
  if (dragSrcIdx.value === null) {
    clearDropIndicator();
    return;
  }
  const targetUid = dragOverUid.value;
  const edge = dragOverEdge.value;
  clearDropIndicator();
  if (!targetUid || !edge) return;
  const overIdx = value.value.rows.findIndex((r) => r._uid === targetUid);
  if (overIdx < 0) return;
  onRowDrop(overIdx, edge);
}

function onRowDrop(overIdx: number, edge: "before" | "after"): void {
  const from = dragSrcIdx.value;
  dragSrcIdx.value = null;
  clearDropIndicator();
  if (from === null || from === overIdx) return;
  // Convert the (overIdx, edge) pair into a single splice-style
  // target index. "before idx N" => insert at N; "after idx N" =>
  // insert at N+1. reorderInjectorRows handles the post-removal
  // shift internally.
  const toIdx = edge === "before" ? overIdx : overIdx + 1;
  const nextRows = reorderInjectorRows(value.value.rows, from, toIdx);
  if (nextRows === value.value.rows) return;

  // Capture the moved row's uid so we can pulse it AFTER the reorder.
  // reorderInjectorRows reassigns slot_name in place (sequential
  // input_N), but _uid is stable per row identity.
  const movedUid = value.value.rows[from]?._uid;

  // Snapshot row positions BEFORE the mutation. applyFlip below
  // diffs against these to compute the slide distance per row.
  const container = listEl.value;
  const before = container
    ? captureRects(container, (el) => el.dataset.uid ?? null)
    : null;

  value.value = { ...value.value, rows: nextRows };
  persist();

  if (container && before) {
    // Wait one render tick so Vue commits the new row order to the
    // DOM before we re-measure rects in applyFlip.
    void nextTick(() => {
      applyFlip(container, before, (el) => el.dataset.uid ?? null);
    });
  }

  // Drop-pulse on the dropped row. Delay the class apply by
  // MOTION_FLIP_MS so the FLIP slide finishes first — without the
  // delay the pulse ring would paint mid-swap on a row that's still
  // animating into position (matches ContextWidget's pulseDrop
  // pattern). Skip entirely under reduce-motion.
  if (movedUid && !document.body.classList.contains("wp-a11y-no-motion")) {
    setTimeout(() => {
      recentDropUids.value = new Set([...recentDropUids.value, movedUid]);
      setTimeout(() => {
        const next = new Set(recentDropUids.value);
        next.delete(movedUid);
        recentDropUids.value = next;
      }, DROP_PULSE_MS);
    }, MOTION_FLIP_MS);
  }
}

function onRowDragEnd(): void {
  dragSrcIdx.value = null;
  clearDropIndicator();
}

// ── Move-to-edge (top / bottom) ────────────────────────────────────
// Same FLIP-animated path as drag-drop reorder, just driven by the
// right-click menu. Falls through to reorderInjectorRows so slot_name
// reassignment + sequential ordering stays consistent with the drag
// path. Skips when the row is already at the target edge.
function moveRowToEdge(idx: number, edge: "top" | "bottom"): void {
  const rows = value.value.rows;
  const toIdx = edge === "top" ? 0 : rows.length;
  if (edge === "top" && idx === 0) return;
  if (edge === "bottom" && idx === rows.length - 1) return;
  const nextRows = reorderInjectorRows(rows, idx, toIdx);
  if (nextRows === rows) return;

  const container = listEl.value;
  const before = container
    ? captureRects(container, (el) => el.dataset.uid ?? null)
    : null;
  value.value = { ...value.value, rows: nextRows };
  persist();
  if (container && before) {
    void nextTick(() => {
      applyFlip(container, before, (el) => el.dataset.uid ?? null);
    });
  }
}

// ── Right-click context menu ───────────────────────────────────────
// Shared ContextMenu component (used by ModuleRow / BundleHeader).
// `openRowContextMenu` builds the items per-row based on current
// state — Enable/Disable + Expand/Collapse labels flip with the row,
// Move-to-{top,bottom} are disabled at the edges, Disconnect is
// the destructive trailing entry.
//
// Type-icon + type-color maps power the menu's scope header (mirrors
// the bundle ctxmenu's `Kind · Name` layout). InjectorRow has its own
// copy of TYPE_ICONS for the row chrome — duplicated here rather than
// exported because exporting from a Vue SFC adds a re-export shim and
// the maps are short. Keep both in lockstep if a new type is added.
const HEADER_TYPE_ICON: Record<string, string> = {
  string: "pi-pencil",
  int: "pi-hashtag",
  float: "pi-percentage",
  boolean: "pi-check-square",
  image: "pi-image",
  mask: "pi-clone",
  latent: "pi-cloud",
  conditioning: "pi-comment",
  model: "pi-cube",
  clip: "pi-tag",
  vae: "pi-box",
  audio: "pi-volume-up",
  video: "pi-video",
  noise: "pi-sparkles",
  sigmas: "pi-chart-line",
  guider: "pi-compass",
  sampler: "pi-sliders-h",
};
const HEADER_TYPE_COLOR: Record<string, string> = {
  string: "var(--wp-amber)",
  int: "var(--wp-green)",
  float: "var(--wp-var-7)",
  boolean: "var(--wp-var-5)",
  image: "var(--wp-var-1)",
  mask: "var(--wp-var-6)",
  latent: "var(--wp-var-4)",
  conditioning: "var(--wp-var-2)",
  model: "var(--wp-var-8)",
  clip: "var(--wp-var-3)",
  vae: "var(--wp-var-6)",
  audio: "var(--wp-var-7)",
  video: "var(--wp-var-4)",
  noise: "var(--wp-var-6)",
  sigmas: "var(--wp-var-1)",
  guider: "var(--wp-var-3)",
  sampler: "var(--wp-var-2)",
};

const ctxMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  header?: { icon: string; label: string; iconColor?: string };
}>({ visible: false, x: 0, y: 0, items: [] });

// Binding edit modal — one row at a time. Stored as the row's `_uid`
// so the modal target stays valid across reorders (idx would shift).
// `null` = closed. Edit ctxmenu item sets this; modal close clears it.
const editingRowUid = ref<string | null>(null);
const editingRow = computed<InjectorRow | null>(() => {
  if (!editingRowUid.value) return null;
  return value.value.rows.find((r) => r._uid === editingRowUid.value) ?? null;
});

function openEditModal(uid: string): void {
  editingRowUid.value = uid;
}
function closeEditModal(): void {
  editingRowUid.value = null;
}

function openRowContextMenu(ev: MouseEvent, idx: number): void {
  const row = value.value.rows[idx];
  if (!row) return;
  const rows = value.value.rows;
  const estW = 250;
  const estH = 280;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  const items: ContextMenuItem[] = [
    {
      label: "Edit",
      icon: "pi-pencil",
      onSelect: () => openEditModal(row._uid),
    },
    {
      label: row.enabled ? "Disable" : "Enable",
      icon: row.enabled ? "pi-eye-slash" : "pi-eye",
      onSelect: () => updateRow(row._uid, { enabled: !row.enabled }),
    },
    {
      label: row._collapsed ? "Expand" : "Collapse",
      icon: row._collapsed ? "pi-caret-down" : "pi-caret-right",
      onSelect: () => updateRow(row._uid, { _collapsed: !row._collapsed }),
      divider: true,
    },
    {
      label: "Move to top",
      icon: "pi-angle-double-up",
      disabled: idx === 0,
      onSelect: () => moveRowToEdge(idx, "top"),
    },
    {
      label: "Move to bottom",
      icon: "pi-angle-double-down",
      disabled: idx === rows.length - 1,
      onSelect: () => moveRowToEdge(idx, "bottom"),
    },
    {
      label: "Disconnect",
      icon: "pi-trash",
      danger: true,
      divider: true,
      onSelect: () => emit("disconnect-slot", row.slot_name),
    },
  ];
  const typeKey = (props.slotTypes[row.slot_name] ?? "").toLowerCase();
  const typeLabel = typeKey ? typeKey[0].toUpperCase() + typeKey.slice(1) : "Input";
  const nameForHeader = row.binding.trim()
    ? `$${row.binding}`
    : (props.slotLabels[row.slot_name] ?? row.slot_name);
  ctxMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    items,
    // Scope header — mirrors the bundle/module ctxmenu pattern:
    // type icon + "<Type> · <Name>". Name falls back to the slot
    // label (e.g. input_0) when no binding is typed yet, so the
    // header always reads as a specific row identifier.
    header: {
      icon: HEADER_TYPE_ICON[typeKey] ?? "pi-circle",
      label: `${typeLabel} · ${nameForHeader}`,
      iconColor: HEADER_TYPE_COLOR[typeKey],
    },
  };
}

defineExpose({ addRow, removeRow });
</script>

<template>
  <div class="wp-inj-widget" :class="{ 'wp-inj-widget--skipped': isSkipped }">
    <div class="wp-inj-header">
      <button
        type="button"
        class="wp-inj-caret"
        :title="collapsed ? 'Expand rows' : 'Collapse rows'"
        :aria-label="collapsed ? 'Expand injector rows' : 'Collapse injector rows'"
        data-test="inj-toolbar-collapse"
        @click="collapsed = !collapsed"
      ><i :class="['pi', collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true" /></button>
      <span data-test="inj-toolbar-label" class="wp-inj-header-label">injected variables</span>
      <span data-test="inj-toolbar-count" class="wp-inj-header-count">{{ enabledCount }} / {{ value.rows.length }}</span>
      <button
        type="button"
        class="wp-inj-collapse-conns"
        :class="{ 'is-active': connectionsCollapsed }"
        :title="connectionsCollapsed ? 'Show all input wires individually' : 'Merge all input wires onto a single pin'"
        :aria-label="connectionsCollapsed ? 'Expand input connections' : 'Collapse input connections'"
        data-test="inj-toolbar-collapse-conns"
        @click="emit('toggle-connections-collapse')"
      >
        <i :class="['pi', connectionsCollapsed ? 'pi-arrows-alt' : 'pi-arrows-v']" aria-hidden="true" />
        <span class="wp-inj-collapse-conns__label">{{ connectionsCollapsed ? "expand wires" : "merge wires" }}</span>
      </button>
    </div>

    <div
      v-if="!collapsed"
      ref="listEl"
      class="wp-inj-list"
      @dragover.prevent="onListDragOver"
      @drop.prevent="onListDrop"
    >
      <InjectorRowComp
        v-for="(row, idx) in value.rows"
        :key="row._uid"
        :class="{ 'wp-drop-pulse': recentDropUids.has(row._uid) }"
        :row="row"
        :index="idx"
        :reorderable="value.rows.length > 1"
        :is-connected="isConnected(row.slot_name)"
        :value-type="slotTypes[row.slot_name]"
        :display-label="slotLabels[row.slot_name]"
        :conflict-severity="conflictByUid[row._uid]?.severity"
        :conflict-label="conflictByUid[row._uid]?.label"
        :drop-indicator="dropIndicatorFor(row._uid)"
        @update="(patch) => updateRow(row._uid, patch)"
        @disconnect="emit('disconnect-slot', row.slot_name)"
        @row-drag-start="(p) => onRowDragStart(p.fromIdx)"
        @row-drag-end="onRowDragEnd"
        @row-contextmenu="(p) => openRowContextMenu(p.ev, p.idx)"
      />
      <div
        v-if="value.rows.length === 0"
        data-test="inj-ghost"
        class="wp-inj-ghost"
      >
        ↓ Wire an upstream node's output into this node's input pin — a variable row appears here.
      </div>
    </div>
    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      :header="ctxMenu.header"
      @close="ctxMenu.visible = false"
    />
    <Teleport to="body">
      <InjectorBindingModal
        v-if="editingRow"
        :row="editingRow"
        :sibling-rows="value.rows"
        :slot-types="slotTypes"
        :slot-labels="slotLabels"
        @update="(patch) => editingRow && updateRow(editingRow._uid, patch)"
        @close="closeEditModal"
      />
    </Teleport>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-inj-widget {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: var(--wp-radius);
  font-family: var(--wp-font-sans);
  color: var(--wp-text);
  overflow: hidden;
  transition: opacity 120ms ease;
}
/* Mute (mode 2) / bypass (mode 4) — dim entire widget body so the
 * muted state mirrors litegraph's title/border dimming. Pointer-events
 * stay on so the user can still edit binding names while the node
 * is paused; engine-side ComfyUI skips execute() outright. */
.wp-inj-widget--skipped { opacity: 0.45; }
.wp-inj-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px;
  font: 500 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-inj-caret {
  background: transparent;
  border: none;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0;
  font-size: 10px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.wp-inj-caret:hover { color: var(--wp-text); }
.wp-inj-caret .pi { font-size: 10px; }
.wp-inj-header-label { flex: 0 0 auto; }
.wp-inj-header-count {
  margin-left: auto;
  font: 600 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
/* Collapse-connections toggle — sits at the right end of the header.
 * Pill-shaped button with persistent bg + border so it reads as
 * tappable at rest (no hover-required affordance). Active (collapsed):
 * accent-tinted so the mode change is obvious at a glance. */
.wp-inj-collapse-conns {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border-soft, var(--wp-border2));
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 10px var(--wp-font-sans);
  letter-spacing: 0.02em;
  padding: 2px 7px;
  margin-left: 4px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.wp-inj-collapse-conns:hover {
  background: color-mix(in srgb, var(--wp-accent) 8%, var(--wp-bg2));
  border-color: color-mix(in srgb, var(--wp-accent) 40%, var(--wp-border-soft, var(--wp-border2)));
  color: var(--wp-text);
}
.wp-inj-collapse-conns.is-active {
  color: var(--wp-accent-text, var(--wp-accent));
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  border-color: color-mix(in srgb, var(--wp-accent) 55%, transparent);
}
.wp-inj-collapse-conns .pi { font-size: 10px; line-height: 1; }
.wp-inj-collapse-conns__label { line-height: 1; }
.wp-inj-list {
  display: flex;
  flex-direction: column;
  /* Match Context's .wp-modules padding so rows have breathing room
   * on all sides of the list, not just between each other. */
  padding: 6px 8px;
}
.wp-inj-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: var(--wp-text-dim, var(--wp-text3));
  font: italic 11px var(--wp-font-sans);
  background: rgba(255, 255, 255, 0.015);
}
</style>
