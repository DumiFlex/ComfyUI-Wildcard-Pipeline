<script setup lang="ts">
/**
 * ConstraintEditor — Wave 4 port of `ConstraintEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity
 *  2. Source / Target wildcards
 *  3. Rule matrix (ConstraintMatrix)
 *  4. Exceptions table
 */
import { computed, onMounted, ref } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState, EditorFieldError } from "../components/EditorFrame.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import DraftBanner from "../components/DraftBanner.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import ConstraintMatrixGrid from "../components/ConstraintMatrix.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { appendSnapshot, readHistory } from "../utils/history";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import { tokenizeRefString, resolveWildcardChip } from "../cascade/resolveChip";
import type { LibraryFixture } from "../cascade/reverse-dep-index";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import PillCountBadge from "../cascade/PillCountBadge.vue";
import ConstraintReattachSection from "../../components/context/editors/constraint/sections/ConstraintReattachSection.vue";
import { walkRemap } from "../../components/context/bundles/uuid-remap";
import { buildWildcardRefData } from "../utils/library-suggestions";
import type {
  ConstraintCell,
  ConstraintException,
  ConstraintMatrix,
  ConstraintMode,
  ConstraintPayload,
  ModuleHistoryEntry,
  ModuleRow,
} from "../api/types";

/** Library-default reach modes. `pick` is deliberately absent — it
 *  names live per-instance `_uid`s that don't exist at library
 *  authoring time (instance-only, set on the modal's TargetReachSection).
 *  Mirrors the `first`/`next`/`all` subset of `TargetSelect`. */
type LibReachMode = "first" | "next" | "all";
type LibTargetSelect = { mode: LibReachMode; count?: number };

const props = defineProps<{ id?: string }>();
const router = useRouter();
const { resolveReturnTo } = useReturnTo();
const moduleStore = useModuleStore();
const currentRow = computed(() =>
  props.id ? moduleStore.catalog.find((m) => m.id === props.id) ?? null : null,
);
const categoryStore = useCategoryStore();
const toast = useToast();
const recent = useRecentStore();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();

const cascadeDialogOpen = ref(false);

const cascadeRefs = computed(() => {
  if (!props.id) return [];
  return cascade.refsTo("constraint", props.id);
});

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  // Always open the cascade dialog — earlier the no-refs branch went
  // straight to cascadeApply.apply without any confirm prompt, which
  // surprised users editing freshly-installed entities. The dialog's
  // own dry-run handles 0 refs cleanly (empty affected list, Delete
  // still front-and-center).
  cascadeDialogOpen.value = true;
}

function onCascadeDialogConfirmed(result: { undo_entry_id: string; affected_count: number }): void {
  cascadeDialogOpen.value = false;
  moduleStore.remove(props.id!);
  const undoId = result.undo_entry_id;
  const count = result.affected_count;
  toast.push({
    severity: "success",
    summary: `"${name.value}" deleted`,
    detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await cascadeApply.undo(undoId);
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          toast.push({ severity: "info", summary: `"${name.value}" restored`, life: 3000 });
        }
      },
    },
  });
  router.push(resolveReturnTo("/constraints"));
}

interface WildcardOption { id: string; value: string; weight: number; sub_categories?: string[]; }
interface WildcardPayloadShape {
  options?: WildcardOption[];
  sub_categories?: string[];
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const contentRating = ref<"safe" | "nsfw">("safe");
const sourceWildcardId = ref<string | null>(null);
const targetWildcardId = ref<string | null>(null);
// Cached display names of the source/target wildcards, captured the moment
// the id is SET (picker / reattach / load). Display-only — they feed the
// broken-reference banner so it can show `(was "Starter subject")` after the
// wildcard is deleted (the engine never reads them; see ConstraintPayload).
const sourceWildcardName = ref<string | null>(null);
const targetWildcardName = ref<string | null>(null);
const matrix = ref<ConstraintMatrix>({});
const exceptions = ref<ConstraintException[]>([]);
// Library-default reach. `all` is the engine default — kept here as the
// initial value; `save()` omits it from the payload when it stays `all`
// (matches how the engine treats an absent `target_select`).
const targetSelect = ref<LibTargetSelect>({ mode: "all" });
const reachCount = computed<number>(() => {
  const c = Number(targetSelect.value.count);
  return Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
});
const saving = ref(false);
const saveState = ref<SaveState>("idle");
const saveError = ref<string>("");
let saveStateTimer: ReturnType<typeof setTimeout> | null = null;

function setSaveState(next: SaveState, ttl?: number): void {
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveState.value = next;
  if (ttl && (next === "saved" || next === "error")) {
    saveStateTimer = setTimeout(() => {
      if (saveState.value === next) saveState.value = "idle";
    }, ttl);
  }
}
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);

// Unsaved-changes guard
const baseline = ref<string>("");

function snapshot(): string {
  return JSON.stringify({
    name: name.value,
    description: description.value,
    categoryId: categoryId.value,
    tags: tags.value,
    sourceWildcardId: sourceWildcardId.value,
    targetWildcardId: targetWildcardId.value,
    sourceWildcardName: sourceWildcardName.value,
    targetWildcardName: targetWildcardName.value,
    matrix: matrix.value,
    exceptions: exceptions.value,
    targetSelect: targetSelect.value,
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

const draft = useEditorDraft({
  kind: "constraint",
  id: props.id ?? "new",
  dirty,
  snapshot,
});

function applyDraft(): void {
  const snap = draft.restore();
  if (!snap) return;
  try {
    const parsed = JSON.parse(snap) as {
      name: string;
      description: string;
      categoryId: string | null;
      tags: string[];
      sourceWildcardId: string | null;
      targetWildcardId: string | null;
      sourceWildcardName?: string | null;
      targetWildcardName?: string | null;
      matrix: ConstraintMatrix;
      exceptions: ConstraintException[];
      targetSelect?: unknown;
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    sourceWildcardId.value = parsed.sourceWildcardId;
    targetWildcardId.value = parsed.targetWildcardId;
    sourceWildcardName.value = parsed.sourceWildcardName ?? null;
    targetWildcardName.value = parsed.targetWildcardName ?? null;
    matrix.value = normalizeMatrix(parsed.matrix);
    exceptions.value = normalizeExceptions(parsed.exceptions);
    targetSelect.value = normalizeTargetSelect(parsed.targetSelect);
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

const MODE_DEFAULT_FACTOR: Record<ConstraintMode, number> = {
  allow: 1,
  exclude: 0,
  boost: 2,
  reduce: 0.5,
};
const MODE_OPTIONS = [
  { label: "Allow", value: "allow" },
  { label: "Exclude", value: "exclude" },
  { label: "Boost", value: "boost" },
  { label: "Reduce", value: "reduce" },
];

/** Mode → {glyph, label, CSS var} for the colored exception-mode chips
 *  (editable Select + read-only table). Mirrors ConstraintMatrix's
 *  MODE_ICON / mode→token mapping so the whole constraint surface speaks
 *  one visual language: boost→success ↑, reduce→warn ↓, exclude→danger ×,
 *  allow(neutral)→muted ·. `cssVar` feeds the chip's color-mix tints in
 *  the template + scoped CSS via a `--cn-mode-var` custom property. */
interface ModeMeta { glyph: string; label: string; cssVar: string }
const MODE_META: Record<ConstraintMode, ModeMeta> = {
  boost: { glyph: "↑", label: "Boost", cssVar: "--wp-success" },
  reduce: { glyph: "↓", label: "Reduce", cssVar: "--wp-warn" },
  exclude: { glyph: "×", label: "Exclude", cssVar: "--wp-danger" },
  allow: { glyph: "·", label: "Neutral", cssVar: "--wp-text-dim" },
};
function modeMeta(mode: ConstraintMode | string | undefined): ModeMeta {
  return MODE_META[(mode ?? "allow") as ConstraintMode] ?? MODE_META.allow;
}

const wildcardOptions = computed(() =>
  moduleStore.catalog
    .filter((m) => m.type === "wildcard")
    .map((m) => ({ label: m.name, value: m.id })),
);

function wildcardById(id: string | null): ModuleRow | undefined {
  if (!id) return undefined;
  return moduleStore.catalog.find((m) => m.id === id);
}

const sourceWildcard = computed(() => wildcardById(sourceWildcardId.value));
const targetWildcard = computed(() => wildcardById(targetWildcardId.value));

/** Source/target dropdown handlers. Repoint the id, reset the matrix (its
 *  axes derive from the new wildcard's sub_categories), and cache the picked
 *  wildcard's display name so the broken-reference banner can show it after
 *  the wildcard is later deleted. Clearing the pick (`v === null`) clears the
 *  cached name too. */
function onSourceWildcardPick(v: string | null): void {
  sourceWildcardId.value = v;
  sourceWildcardName.value = v ? wildcardById(v)?.name ?? null : null;
  matrix.value = {};
}
function onTargetWildcardPick(v: string | null): void {
  targetWildcardId.value = v;
  targetWildcardName.value = v ? wildcardById(v)?.name ?? null : null;
  matrix.value = {};
}

// ── Broken-reference reattach (spec Component B "both sides") ────────
//
// The SPA editor is the OTHER place source/target are authored; it
// mirrors the canvas modal's ConstraintReattachSection. A source/target
// id is DANGLING when non-empty but absent from the live `moduleStore.catalog`
// (the wildcard was deleted/never-installed). The banner above the
// Wildcards card lets the user re-point at a live wildcard.
/** Dangling = a non-empty id not present in the live catalog. */
function isDangling(id: string | null): boolean {
  if (!id) return false;
  return !moduleStore.catalog.some((m) => m.id === id);
}
const danglingSource = computed(() => isDangling(sourceWildcardId.value));
const danglingTarget = computed(() => isDangling(targetWildcardId.value));
const hasDangling = computed(() => danglingSource.value || danglingTarget.value);
const reattachRefData = computed(() => buildWildcardRefData(moduleStore.catalog));

/** SPA editor edits the LIBRARY row directly (Save persists it). The
 *  constraint's reverse-deps are surfaced by `cascadeRefs` (the used-by
 *  count already in this view) — warn when >0. */
const referencedElsewhere = computed(() => cascadeRefs.value.length > 0);

/** Live pre-confirm reattach selection, surfaced by the section's `@pick`.
 *  Drives the dropped-cell preview; reset to null when the section abandons
 *  the pick (`@pickcleared`) or after a reattach is handled. */
const reattachPick = ref<{ side: "source" | "target"; uuid: string } | null>(null);

/** Cells the picked candidate would DROP from the current matrix, counted
 *  at the cell level (not axis keys) so the pre-confirm preview is honest:
 *   - a vanished SOURCE row drops every cell in that row;
 *   - a vanished TARGET key drops one cell per row that carries it.
 *  The candidate's sub_categories come from the same ref-data the dropdown
 *  picks from; an empty/unknown set means every current key vanishes.
 *  Mirrors ConstraintInstanceModal's `reattachDroppedCellCount`. */
const reattachDroppedCellCount = computed(() => {
  const pick = reattachPick.value;
  if (!pick) return 0;
  const m = matrix.value;
  const newSubs = new Set(reattachRefData.value.uuidToSubCategories.get(pick.uuid) ?? []);
  let dropped = 0;
  if (pick.side === "source") {
    for (const [srcKey, row] of Object.entries(m)) {
      if (!newSubs.has(srcKey)) dropped += Object.keys(row ?? {}).length;
    }
  } else {
    for (const row of Object.values(m)) {
      for (const tgtKey of Object.keys(row ?? {})) {
        if (!newSubs.has(tgtKey)) dropped += 1;
      }
    }
  }
  return dropped;
});

function onReattach(payload: { side: "source" | "target"; oldUuid: string; newUuid: string; newName: string }): void {
  if (payload.side === "source") {
    sourceWildcardId.value = payload.newUuid;
    // Re-cache the display name from the picked candidate so the banner
    // (and a later re-deletion) reflects the new wildcard, not the stale one.
    sourceWildcardName.value = payload.newName;
  } else {
    targetWildcardId.value = payload.newUuid;
    targetWildcardName.value = payload.newName;
  }
  // walkRemap embedded @{oldUuid} refs inside matrix + exceptions so they
  // follow (segments preserved). Matrix rows/cols re-derive from the new
  // wildcard's sub_categories via sourceSubCategories/targetSubCategories,
  // so cells on vanished keys drop from the grid + persist out on save.
  const table = { [payload.oldUuid]: payload.newUuid };
  matrix.value = walkRemap(matrix.value, table) as typeof matrix.value;
  exceptions.value = walkRemap(exceptions.value, table) as typeof exceptions.value;
  // Pick consumed — clear the live preview so a stale dropped-cell count
  // can't survive into the next reattach.
  reattachPick.value = null;
}

// Matrix axes are BOTH sub-categories — source's on the rows, target's
// on the cols. Source-value-keyed cells (the prior shape) confused the
// "rule" semantics: a constraint matrix expresses category-level
// boost/exclude rules, not per-option overrides. Per-option overrides
// belong in the Exceptions table beneath the matrix.
const sourceSubCategories = computed<string[]>(() => {
  const wc = sourceWildcard.value;
  if (wc) return (wc.payload as WildcardPayloadShape).sub_categories ?? [];
  // Stranded source (id set, wildcard deleted): reconstruct the row axis from
  // the saved matrix keys so the configured rules stay visible read-only.
  if (sourceWildcardId.value) return Object.keys(matrix.value ?? {});
  return [];
});

const targetSubCategories = computed<string[]>(() => {
  const wc = targetWildcard.value;
  if (wc) return (wc.payload as WildcardPayloadShape).sub_categories ?? [];
  // Stranded target: reconstruct the col axis from every cell's keys.
  if (targetWildcardId.value) {
    const cols = new Set<string>();
    for (const row of Object.values(matrix.value ?? {})) {
      for (const c of Object.keys((row ?? {}) as Record<string, unknown>)) cols.add(c);
    }
    return [...cols];
  }
  return [];
});

/** Source and/or target wildcard is missing (id set but absent from the
 *  catalog). Reuses the existing dangling computeds, which mean exactly
 *  that. Drives the read-only recovery render of the matrix + exceptions:
 *  the data survives a deleted wildcard but can't be safely edited (its
 *  axes/options may have changed) — reattach a live wildcard to edit. */
const refMissing = computed(() => danglingSource.value || danglingTarget.value);

/** The name to persist for the source / target wildcard: the cached name if
 *  present, else the LIVE wildcard's current name. This backfills the cache
 *  for a legacy constraint whose ref is still live — capturing the name NOW,
 *  while the wildcard exists, so a later deletion's broken-ref banner can show
 *  "(was …)" instead of a bare uuid (the name is unrecoverable once the
 *  wildcard is gone). A stranded ref has no live wildcard, so its cached value
 *  (or null) is kept untouched. Consumed by `save()`; display-only — the
 *  engine never reads these. Computed (not a load-time mutation) so opening a
 *  constraint never marks it dirty. */
const resolvedSourceName = computed(
  () => sourceWildcardName.value || sourceWildcard.value?.name || null,
);
const resolvedTargetName = computed(
  () => targetWildcardName.value || targetWildcard.value?.name || null,
);

/** First 8 hex of a wildcard uuid for the locked-field "<short> · missing"
 *  sub-line. Matches the short-id convention used across the cascade /
 *  reattach surfaces (`id.slice(0, 8)`). */
const sourceShortId = computed(() => (sourceWildcardId.value ?? "").slice(0, 8));
const targetShortId = computed(() => (targetWildcardId.value ?? "").slice(0, 8));

// Display labels resolve `@{uuid}` tokens in option-value strings to
// `@wildcard_name` chips so the Exceptions table renders the picked
// wildcards' names instead of raw 8-hex ids. Backend value stays the
// raw string for compat with the runtime resolver. Issue #6 fix from
// 2026-05-24 live QA.
const wildcardLibFixture = computed<LibraryFixture>(() => ({
  wildcards: moduleStore.catalog
    .filter((m) => m.type === "wildcard")
    .map((m) => ({ id: m.id, name: m.name, payload: m.payload })),
  constraints: [],
  fixed_values: [],
  combines: [],
  derivations: [],
  bundles: [],
  categories: [],
}));

/** uuid → display name map. Used by `RichTextPreview` so nested-ref
 *  tokens inside option values + exceptions render as the same purple
 *  ref chip the value editor shows — instead of raw `@{c0f09840}`. */
const wildcardUuidToName = computed<ReadonlyMap<string, string>>(() => {
  const m = new Map<string, string>();
  for (const w of moduleStore.catalog) {
    if (w.type !== "wildcard") continue;
    if (typeof w.name === "string" && w.name.length > 0) m.set(w.id, w.name);
  }
  return m;
});

function displayLabel(raw: string): string {
  if (!raw) return raw;
  const tokens = tokenizeRefString(raw);
  let out = "";
  for (const tok of tokens) {
    if (tok.type === "text") {
      out += tok.value;
    } else {
      const res = resolveWildcardChip(tok.uuid, wildcardLibFixture.value);
      if (res.missing) {
        out += `@?${tok.uuid}`;
      } else {
        out += `@${res.name}`;
      }
      if (tok.subcat) out += `:${tok.subcat}`;
    }
  }
  return out;
}

// Per-option pickers used by the Exceptions editor below the matrix.
// Exceptions DO operate at value granularity (override one specific
// option-pair regardless of what the sub-category matrix says) so we
// keep these computed for that table only.
const sourceValues = computed<string[]>(() => {
  const wc = sourceWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  const values = (payload.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return Array.from(new Set(values));
});

const targetValues = computed<string[]>(() => {
  const wc = targetWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  const values = (payload.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return Array.from(new Set(values));
});

/** True when the source / target wildcard has a null option. Drives
 *  the dropdown's "null" sentinel entry so users can author an
 *  exception that explicitly targets the null option (stored with
 *  source/target as empty string). */
const sourceHasNull = computed<boolean>(() => {
  const wc = sourceWildcard.value;
  if (!wc) return false;
  const opts = (wc.payload as WildcardPayloadShape).options ?? [];
  return opts.some((o) => (o as { is_null?: boolean }).is_null === true);
});
const targetHasNull = computed<boolean>(() => {
  const wc = targetWildcard.value;
  if (!wc) return false;
  const opts = (wc.payload as WildcardPayloadShape).options ?? [];
  return opts.some((o) => (o as { is_null?: boolean }).is_null === true);
});

/** Sentinel label the dropdown's render layer swaps for a pi-ban chip.
 *  The actual stored exception value remains "" so engine + simulator
 *  exception-keying continues to work via the empty-string key. */
const NULL_OPT_LABEL = "⌀ null";

function exceptionSrcOptions() {
  const base = sourceValues.value.map((v) => ({ label: displayLabel(v), value: v }));
  if (sourceHasNull.value) base.unshift({ label: NULL_OPT_LABEL, value: "" });
  return base;
}
function exceptionTgtOptions() {
  const base = targetValues.value.map((v) => ({ label: displayLabel(v), value: v }));
  if (targetHasNull.value) base.unshift({ label: NULL_OPT_LABEL, value: "" });
  return base;
}

function normalizeMatrix(raw: unknown): ConstraintMatrix {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ConstraintMatrix = {};
  for (const [r, byCol] of Object.entries(raw as Record<string, unknown>)) {
    if (!byCol || typeof byCol !== "object") continue;
    out[r] = {};
    for (const [c, cellRaw] of Object.entries(byCol as Record<string, unknown>)) {
      const cell = cellRaw as Partial<ConstraintCell>;
      const mode = (cell?.mode ?? "allow") as ConstraintMode;
      const factor =
        typeof cell?.factor === "number" ? cell.factor : MODE_DEFAULT_FACTOR[mode];
      out[r][c] = { mode, factor };
    }
  }
  return out;
}

/**
 * Refresh each exception's legacy `source` / `target` value-strings from
 * the current option pointed at by `source_id` / `target_id`. Needed
 * because the user may have renamed an option's value upstream — the id
 * still resolves correctly, but the cached value string is stale, so
 * the Select dropdown can't match it and falls back to "Pick value".
 *
 * Returns true if anything changed (so the baseline snapshot can rerun
 * without flagging the editor as dirty).
 */
function rehydrateExceptionsFromIds(): boolean {
  let changed = false;
  const srcWc = sourceWildcard.value;
  const tgtWc = targetWildcard.value;
  if (!srcWc && !tgtWc) return false;
  const srcOpts =
    (srcWc?.payload as WildcardPayloadShape | undefined)?.options ?? [];
  const tgtOpts =
    (tgtWc?.payload as WildcardPayloadShape | undefined)?.options ?? [];
  const srcById = new Map<string, string>();
  for (const o of srcOpts) {
    const oid = (o as { id?: string }).id;
    const val = (o as { value?: string }).value;
    if (typeof oid === "string" && typeof val === "string") srcById.set(oid, val);
  }
  const tgtById = new Map<string, string>();
  for (const o of tgtOpts) {
    const oid = (o as { id?: string }).id;
    const val = (o as { value?: string }).value;
    if (typeof oid === "string" && typeof val === "string") tgtById.set(oid, val);
  }
  // Reverse lookup maps for auto-heal: value → id. Built only when at
  // least one exception is missing its id (skip the work otherwise).
  let srcByValue: Map<string, string> | undefined;
  let tgtByValue: Map<string, string> | undefined;
  function _byValue(opts: typeof srcOpts): Map<string, string> {
    const m = new Map<string, string>();
    for (const o of opts) {
      const oid = (o as { id?: string }).id;
      const val = (o as { value?: string }).value;
      if (typeof oid === "string" && typeof val === "string") m.set(val, oid);
    }
    return m;
  }
  for (const ex of exceptions.value) {
    if (ex.source_id) {
      const current = srcById.get(ex.source_id);
      if (typeof current === "string" && current !== ex.source) {
        ex.source = current;
        changed = true;
      }
    } else if (ex.source) {
      // Auto-heal: legacy exception created before id-tracking shipped.
      // If the stored value still matches a current option, capture its
      // id so future renames can rehydrate via the id path.
      if (!srcByValue) srcByValue = _byValue(srcOpts);
      const matched = srcByValue.get(ex.source);
      if (matched) {
        ex.source_id = matched;
        changed = true;
      }
    }
    if (ex.target_id) {
      const current = tgtById.get(ex.target_id);
      if (typeof current === "string" && current !== ex.target) {
        ex.target = current;
        changed = true;
      }
    } else if (ex.target) {
      if (!tgtByValue) tgtByValue = _byValue(tgtOpts);
      const matched = tgtByValue.get(ex.target);
      if (matched) {
        ex.target_id = matched;
        changed = true;
      }
    }
  }
  return changed;
}

function normalizeExceptions(raw: unknown): ConstraintException[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const r = e as Record<string, unknown>;
      const source = typeof r.source === "string" ? r.source : "";
      const target = typeof r.target === "string" ? r.target : "";
      const source_id = typeof r.source_id === "string" ? r.source_id : undefined;
      const target_id = typeof r.target_id === "string" ? r.target_id : undefined;
      const mode = (typeof r.mode === "string" ? r.mode : "allow") as ConstraintMode;
      const factor =
        typeof r.factor === "number" ? r.factor : MODE_DEFAULT_FACTOR[mode] ?? 1;
      return { source, target, source_id, target_id, mode, factor } as ConstraintException;
    })
    .filter((x): x is ConstraintException => x !== null);
}

/** Coerce a loose payload `target_select` into the library subset
 *  (`first`/`next`/`all`). A `pick` selector authored on an instance and
 *  somehow round-tripped into the library payload degrades to `all` — the
 *  manager can't edit instance picks, so showing them would be a lie.
 *  Absent / malformed = `all` (the engine default). */
function normalizeTargetSelect(raw: unknown): LibTargetSelect {
  if (!raw || typeof raw !== "object") return { mode: "all" };
  const r = raw as Record<string, unknown>;
  if (r.mode === "first") return { mode: "first" };
  if (r.mode === "next") {
    const c = Number(r.count);
    const count = Number.isFinite(c) && c >= 1 ? Math.floor(c) : 1;
    return { mode: "next", count };
  }
  return { mode: "all" };
}

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      contentRating.value = row.content_rating ?? "safe";
      const p = row.payload as Partial<ConstraintPayload>;
      sourceWildcardId.value = p.source_wildcard_id ?? null;
      targetWildcardId.value = p.target_wildcard_id ?? null;
      sourceWildcardName.value = p.source_wildcard_name ?? null;
      targetWildcardName.value = p.target_wildcard_name ?? null;
      matrix.value = normalizeMatrix(p.matrix);
      exceptions.value = normalizeExceptions(p.exceptions);
      targetSelect.value = normalizeTargetSelect(p.target_select);
      // Refresh exception value-strings from source_id / target_id in case
      // an upstream wildcard's option value was renamed since this
      // constraint was last opened. Re-anchor baseline below so this
      // doesn't flag the editor as dirty.
      rehydrateExceptionsFromIds();
      historyEntries.value = readHistory(row.payload);
      recent.push({ id: props.id, kind: "constraint", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Constraint not found" });
      router.replace("/constraints");
    }
  }
  baseline.value = snapshot();
});

function onMatrixUpdate(next: ConstraintMatrix) {
  matrix.value = next;
}

function addException() {
  exceptions.value.push({ source: "", target: "", mode: "allow", factor: 1 });
}
function removeException(idx: number) {
  exceptions.value.splice(idx, 1);
}

/** Resolve a value-string to its current option `id` on a wildcard.
 *
 * Returns `undefined` if no match (lets the exception keep source_id
 * empty rather than freezing a stale id). Used by the source/target
 * dropdown handlers to keep id + value pair in sync on every pick. */
function _lookupOptionIdByValue(
  wildcard: ModuleRow | undefined,
  value: string,
): string | undefined {
  if (!wildcard || !value) return undefined;
  const opts = (wildcard.payload as WildcardPayloadShape | undefined)?.options ?? [];
  for (const o of opts) {
    if ((o as { value?: string }).value === value) {
      return (o as { id?: string }).id;
    }
  }
  return undefined;
}

function onExceptionSourcePick(idx: number, value: string) {
  const ex = exceptions.value[idx];
  if (!ex) return;
  ex.source = value;
  ex.source_id = _lookupOptionIdByValue(sourceWildcard.value, value);
}

function onExceptionTargetPick(idx: number, value: string) {
  const ex = exceptions.value[idx];
  if (!ex) return;
  ex.target = value;
  ex.target_id = _lookupOptionIdByValue(targetWildcard.value, value);
}
function setExceptionMode(idx: number, mode: ConstraintMode) {
  const ex = exceptions.value[idx];
  if (!ex) return;
  ex.mode = mode;
  ex.factor = MODE_DEFAULT_FACTOR[mode] ?? 1;
}

const REACH_MODES: Array<{ key: LibReachMode; label: string }> = [
  { key: "first", label: "first" },
  { key: "next", label: "next N" },
  { key: "all", label: "all" },
];

/** Switch reach mode. Entering `next` seeds `count` from the current
 *  stepper value (min 1) so the field is never blank; `first`/`all` carry
 *  no extra fields. */
function setReachMode(mode: LibReachMode): void {
  if (mode === targetSelect.value.mode) return;
  targetSelect.value = mode === "next" ? { mode: "next", count: reachCount.value } : { mode };
}

function onReachCountInput(ev: Event): void {
  const raw = Number((ev.target as HTMLInputElement).value);
  const n = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  targetSelect.value = { mode: "next", count: n };
}

/** Step the next-N reach count by ±1, clamped to >= 1. Backs the up/down
 *  stepper chevrons so the control matches the exceptions factor Input
 *  (which has stacked steppers). Reuses the same min-1 clamp as the typed
 *  path above. */
function bumpReach(direction: 1 | -1): void {
  const n = reachCount.value + direction;
  targetSelect.value = { mode: "next", count: n >= 1 ? n : 1 };
}

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<ConstraintPayload>;
  sourceWildcardId.value = p.source_wildcard_id ?? null;
  targetWildcardId.value = p.target_wildcard_id ?? null;
  sourceWildcardName.value = p.source_wildcard_name ?? null;
  targetWildcardName.value = p.target_wildcard_name ?? null;
  matrix.value = normalizeMatrix(p.matrix);
  exceptions.value = normalizeExceptions(p.exceptions);
  targetSelect.value = normalizeTargetSelect(p.target_select);
  rehydrateExceptionsFromIds();
  toast.push({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  if (validationErrors.value.length > 0) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;
  setSaveState("saving");
  saving.value = true;
  try {
    const payload: ConstraintPayload = {
      source_wildcard_id: sourceWildcardId.value,
      target_wildcard_id: targetWildcardId.value,
      // Cached display names — persisted only when known so legacy / never-set
      // constraints stay clean (absent → banner falls back to uuid-only).
      // Display-only; the engine never reads them.
      ...(resolvedSourceName.value ? { source_wildcard_name: resolvedSourceName.value } : {}),
      ...(resolvedTargetName.value ? { target_wildcard_name: resolvedTargetName.value } : {}),
      matrix: matrix.value,
      exceptions: exceptions.value,
      // Always stamp the reach selector. `{mode:"all"}` is the engine
      // default, but stamping it explicitly keeps the published payload
      // self-describing (the download/install path doesn't have to infer
      // intent from an absent field) and matches how the editor persists
      // its other payload fields.
      target_select:
        targetSelect.value.mode === "next"
          ? { mode: "next", count: reachCount.value }
          : { mode: targetSelect.value.mode },
    };
    const newPayload = payload as unknown as Record<string, unknown>;
    if (isEdit.value && props.id) {
      const prev = await moduleStore.get(props.id);
      const nextHistory = appendSnapshot(
        {
          name: prev.name,
          description: prev.description,
          category_id: prev.category_id,
          tags: prev.tags,
          payload: prev.payload as Record<string, unknown>,
        },
        prev.payload as Record<string, unknown>,
      );
      await moduleStore.update(props.id, {
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        content_rating: contentRating.value,
        payload: { ...newPayload, history: nextHistory },
      });
      historyEntries.value = nextHistory;
      recent.push({ id: props.id, kind: "constraint", name: name.value });
    } else {
      // New mode: the new row id is not surfaced here; mount-time push fires
      // next time the user opens this item.
      await moduleStore.create({
        type: "constraint",
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        content_rating: contentRating.value,
        payload: newPayload,
      });
    }
    draft.discard();
    setSaveState("saved", 1500);
    baseline.value = snapshot();
    toast.push({
      severity: "success",
      summary: isEdit.value ? "Saved" : "Created",
      detail: name.value,
    });
    router.push(resolveReturnTo("/constraints"));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/constraints")); }

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/constraints", label: "Constraints" },
  { label: isEdit.value ? (name.value || "Editing") : "New constraint" },
]);

/** Flipped on the first invalid Save attempt; gates rollup visibility
 *  so the banner appears as feedback, not pre-emptive nagging. */
const showErrors = ref(false);

const validationErrors = computed<EditorFieldError[]>(() => {
  const out: EditorFieldError[] = [];
  if (!name.value.trim()) {
    out.push({ field: "editor-section-identity", label: "Name", message: "Required" });
  }
  if (!sourceWildcardId.value) {
    out.push({ field: "editor-section-wildcards", label: "Source wildcard", message: "Required" });
  }
  if (!targetWildcardId.value) {
    out.push({ field: "editor-section-wildcards", label: "Target wildcard", message: "Required" });
  }
  return out;
});

const visibleErrors = computed<EditorFieldError[]>(() =>
  showErrors.value ? validationErrors.value : [],
);

defineExpose({ sourceWildcardId, targetWildcardId, sourceWildcardName, targetWildcardName, resolvedSourceName, resolvedTargetName, matrix, exceptions, targetSelect, applyRestore, displayLabel });
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit constraint' : 'New constraint'"
    back-route="/constraints"
    back-label="Constraints"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :save-state="saveState"
    :save-error="saveError"
    :dirty="dirty"
    :history-entries="historyEntries"
    :errors="visibleErrors"
    @save="save"
    @cancel="cancel"
    @restore="applyRestore"
  >
    <template v-if="isEdit" #header-extra>
      <span v-if="cascadeRefs.length > 0" class="wp-editor-used-by">
        used by <PillCountBadge :count="cascadeRefs.length" />
      </span>
      <CommunityRowActions
        v-if="currentRow"
        :row="currentRow"
        kind="module"
        labeled
      />
    </template>
    <template v-if="isEdit" #footer-left>
      <Button
        variant="ghost"
        icon="pi-trash"
        class="wp-btn--danger"
        data-test="cn-delete-btn"
        @click="onEntityDeleteClick"
      >Delete</Button>
    </template>
    <template #draft-banner>
      <DraftBanner
        :has-draft="draft.hasDraft.value"
        :age-ms="draft.draftAge.value"
        @restore="applyDraft"
        @discard="draft.discard"
      />
    </template>
    <div id="editor-section-identity">
      <IdentityCard
        :name="name"
        :description="description"
        :category-id="categoryId"
        :tags="tags"
        @update:name="(v) => (name = v)"
        @update:description="(v) => (description = v)"
        @update:category-id="(v) => (categoryId = v)"
        :content-rating="contentRating"
        @update:tags="(v) => (tags = v)"
        @update:content-rating="(v) => (contentRating = v)"
      />
    </div>

    <ConstraintReattachSection
      v-if="hasDangling"
      :dangling-source="danglingSource"
      :dangling-target="danglingTarget"
      :source-uuid="sourceWildcardId ?? ''"
      :source-cached-name="sourceWildcardName ?? ''"
      :target-uuid="targetWildcardId ?? ''"
      :target-cached-name="targetWildcardName ?? ''"
      :ref-data="reattachRefData"
      :referenced-elsewhere="referencedElsewhere"
      :dropped-cell-count="reattachDroppedCellCount"
      @reattach="onReattach"
      @pick="reattachPick = $event"
      @pickcleared="reattachPick = null"
    />

    <div id="editor-section-wildcards">
    <Card title="Wildcards">
      <template #actions>
        <span class="wp-card__hint">Pick the two wildcards whose sub-categories form the matrix</span>
      </template>
      <!-- 3-col × 3-row grid (label / input / hint), grid-template-areas
           place the X cross in the input row only — vertically centered
           against the Select, not the label-stacked Field column. -->
      <div class="cn-pair">
        <label class="cn-pair-label" style="grid-area: src-label" for="cn-source-select">
          Source wildcard
        </label>
        <label class="cn-pair-label" style="grid-area: tgt-label" for="cn-target-select">
          Target wildcard
        </label>
        <div style="grid-area: src-input">
          <!-- Force-Reattach: while EITHER ref is broken, both dropdowns are
               locked (a broken constraint can't be edited piecemeal — the
               banner's Reattach is the only fix). The dangling side reads
               danger + "<short> · missing"; the live side reads dim. -->
          <div
            v-if="refMissing"
            class="cn-locked"
            :class="{ 'cn-locked--danger': danglingSource }"
            data-test="source-locked"
          >
            <i class="pi pi-lock cn-locked__icon" aria-hidden="true" />
            <span class="cn-locked__body">
              <span class="cn-locked__name">{{ resolvedSourceName || "—" }}</span>
              <span v-if="danglingSource" class="cn-locked__sub">{{ sourceShortId }} · missing</span>
            </span>
          </div>
          <Select
            v-else
            id="cn-source-select"
            :model-value="sourceWildcardId"
            :options="wildcardOptions"
            placeholder="Pick source"
            clearable
            data-test="source-wildcard-select"
            aria-label="Source wildcard"
            @update:model-value="(v) => onSourceWildcardPick(v as string | null)"
          />
        </div>
        <div class="cn-cross"><i class="pi pi-times" /></div>
        <div style="grid-area: tgt-input">
          <div
            v-if="refMissing"
            class="cn-locked"
            :class="{ 'cn-locked--danger': danglingTarget }"
            data-test="target-locked"
          >
            <i class="pi pi-lock cn-locked__icon" aria-hidden="true" />
            <span class="cn-locked__body">
              <span class="cn-locked__name">{{ resolvedTargetName || "—" }}</span>
              <span v-if="danglingTarget" class="cn-locked__sub">{{ targetShortId }} · missing</span>
            </span>
          </div>
          <Select
            v-else
            id="cn-target-select"
            :model-value="targetWildcardId"
            :options="wildcardOptions"
            placeholder="Pick target"
            clearable
            data-test="target-wildcard-select"
            aria-label="Target wildcard"
            @update:model-value="(v) => onTargetWildcardPick(v as string | null)"
          />
        </div>
        <div class="cn-pair-hint" style="grid-area: src-hint">Rows of the matrix</div>
        <div class="cn-pair-hint" style="grid-area: tgt-hint">Columns of the matrix</div>
      </div>
    </Card>
    </div>

    <div id="editor-section-matrix">
    <Card title="Rule matrix">
      <template #actions>
        <!-- Stranded ref → the grid is a read-only snapshot, so swap the
             "click to edit" affordance for a lock pill. Reattaching a live
             wildcard (banner above) is the only way back to editing. -->
        <span
          v-if="refMissing"
          class="cn-lock-pill"
          data-test="matrix-readonly-pill"
        >
          <i class="pi pi-lock" aria-hidden="true" /> Read-only
        </span>
        <span v-else class="wp-card__hint">Click a cell to edit rule + factor</span>
      </template>
      <div
        v-if="!sourceWildcardId || !targetWildcardId"
        class="wp-empty-card"
        data-test="matrix-empty"
      >
        Pick a source and target wildcard to populate the matrix.
      </div>
      <div
        v-else-if="sourceSubCategories.length === 0 || targetSubCategories.length === 0"
        class="wp-empty-card"
        data-test="matrix-need-subs"
      >
        <i class="pi pi-info-circle" />
        <!-- With the keys-fallback filling the axes for a stranded ref, this
             branch only fires when the reconstructed axes are ALSO empty —
             i.e. a deleted wildcard whose constraint has no saved rules. -->
        <template v-if="refMissing">
          The source or target wildcard was deleted and this constraint has no
          saved rules — reattach a live wildcard to restore the matrix.
        </template>
        <template v-else>
          <span v-if="sourceSubCategories.length === 0">Source wildcard needs at least one sub-category. </span>
          <span v-if="targetSubCategories.length === 0">Target wildcard needs at least one sub-category. </span>
          Add them on the wildcard editor to define rules.
        </template>
      </div>
      <ConstraintMatrixGrid
        v-else
        :rows="sourceSubCategories"
        :cols="targetSubCategories"
        :model-value="matrix"
        :source-name="sourceWildcard?.name ?? (sourceWildcardName ?? '')"
        :target-name="targetWildcard?.name ?? (targetWildcardName ?? '')"
        :readonly="refMissing"
        data-test="matrix-grid"
        @update:model-value="onMatrixUpdate"
      />
    </Card>
    </div>

    <div id="editor-section-reach">
    <Card title="Target reach">
      <template #actions>
        <span class="wp-card__hint">How many downstream target instances this constraint covers by default</span>
      </template>
      <!-- Library default `target_select`. Modes first / next N / all
           ONLY — `pick` names live per-instance occurrences that don't
           exist at library-authoring time, so it's offered on the
           instance modal (TargetReachSection), not here. -->
      <div class="cn-reach">
        <div class="cn-reach-seg" role="group" aria-label="Target reach mode">
          <button
            v-for="m in REACH_MODES"
            :key="m.key"
            type="button"
            class="cn-reach-btn"
            :class="{ active: targetSelect.mode === m.key }"
            :aria-pressed="targetSelect.mode === m.key"
            :data-test="`cn-reach-mode-${m.key}`"
            @click="setReachMode(m.key)"
          >{{ m.label }}</button>
          <span v-if="targetSelect.mode === 'next'" class="cn-reach-step">
            <input
              class="cn-reach-step__field"
              type="number"
              min="1"
              step="1"
              :value="reachCount"
              aria-label="Number of downstream targets"
              data-test="cn-reach-count"
              @input="onReachCountInput"
            />
            <!-- Stacked stepper chevrons — mirrors the exceptions factor
                 Input's spinner so both numeric controls feel the same. -->
            <span class="cn-reach-step__spin" aria-hidden="true">
              <button
                type="button"
                class="cn-reach-step__btn"
                tabindex="-1"
                aria-label="Increase target count"
                @click="bumpReach(1)"
              ><i class="pi pi-chevron-up" /></button>
              <button
                type="button"
                class="cn-reach-step__btn"
                tabindex="-1"
                aria-label="Decrease target count"
                @click="bumpReach(-1)"
              ><i class="pi pi-chevron-down" /></button>
            </span>
          </span>
        </div>
        <span class="cn-reach-hint" data-test="cn-reach-hint">
          <template v-if="targetSelect.mode === 'all'">Re-weights every downstream target instance.</template>
          <template v-else-if="targetSelect.mode === 'first'">Re-weights only the first downstream target instance.</template>
          <template v-else>Re-weights the first {{ reachCount }} downstream target {{ reachCount === 1 ? "instance" : "instances" }}.</template>
        </span>
      </div>
    </Card>
    </div>

    <div id="editor-section-exceptions">
    <Card :title="`Exceptions (${exceptions.length})`" :padding="false">
      <template #actions>
        <!-- Editing requires a live wildcard — the value pickers are empty
             when the ref is missing, so authoring a new exception is hidden
             in the read-only recovery view. -->
        <Button v-if="!refMissing" size="sm" variant="primary" icon="pi-plus" data-test="add-exception" @click="addException">
          Add exception
        </Button>
      </template>
      <div v-if="!exceptions.length" class="wp-empty-card">
        <i class="pi pi-info-circle" />
        Per-pair overrides for specific option values that the matrix doesn't cover.
      </div>
      <!-- Read-only recovery view: the source/target wildcard was deleted, so
           the exception option lists (built from the LIVE wildcard's values)
           are empty and would swallow the stored source/target in the edit
           Selects. Show the configured overrides as plain text instead.
           displayLabel resolves any @{uuid} token to its name. -->
      <table
        v-else-if="refMissing"
        class="wp-table wp-options-table cn-ex-table"
        data-test="cn-ex-readonly"
      >
        <thead>
          <tr>
            <th class="cn-ex-th-src">Source value</th>
            <th class="cn-ex-th-tgt">Target value</th>
            <th class="cn-col-mode">Mode</th>
            <th class="cn-col-factor">Factor</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(ex, idx) in exceptions"
            :key="idx"
            class="cn-ex-row"
            :style="{ '--cn-mode-var': `var(${modeMeta(ex.mode).cssVar})` }"
          >
            <td class="wp-mono" data-test="cn-ex-ro-src">{{ displayLabel(ex.source) || "⌀ null" }}</td>
            <td class="wp-mono" data-test="cn-ex-ro-tgt">{{ displayLabel(ex.target) || "⌀ null" }}</td>
            <td data-test="cn-ex-ro-mode">
              <span
                class="cn-mode-chip cn-mode-chip--ro"
                :style="{ '--cn-mode-var': `var(${modeMeta(ex.mode).cssVar})` }"
                data-test="cn-ex-ro-mode-chip"
              >
                <span class="cn-mode-chip__glyph" aria-hidden="true">{{ modeMeta(ex.mode).glyph }}</span>
                {{ modeMeta(ex.mode).label }}
              </span>
            </td>
            <td data-test="cn-ex-ro-factor">
              <span v-if="ex.mode === 'boost' || ex.mode === 'reduce'" class="wp-mono">×{{ ex.factor }}</span>
              <span v-else class="wp-dim wp-mono cn-dash">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <table v-else class="wp-table wp-options-table cn-ex-table">
        <thead>
          <tr>
            <th class="cn-ex-th-src">Source value</th>
            <th class="cn-ex-th-tgt">Target value</th>
            <th class="cn-col-mode">Mode</th>
            <th class="cn-col-factor">Factor</th>
            <th class="cn-col-trash" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(ex, idx) in exceptions"
            :key="idx"
            class="cn-ex-row"
            :style="{ '--cn-mode-var': `var(${modeMeta(ex.mode).cssVar})` }"
          >
            <td>
              <Select
                :model-value="ex.source"
                :options="exceptionSrcOptions()"
                placeholder="Pick value"
                aria-label="Exception source value"
                data-test="cn-ex-src-select"
                @update:model-value="(v) => onExceptionSourcePick(idx, v as string)"
              >
                <!-- Trigger label + dropdown items render nested `@{uuid}`
                     tokens via RichTextPreview. NULL_OPT_LABEL stays
                     plain text — RichTextPreview leaves non-ref chars
                     alone, so the ⌀ glyph + "null" word still come
                     through unchanged. -->
                <template #label="{ option }">
                  <RichTextPreview
                    :value="String(option.value) === '' ? option.label : String(option.value)"
                    :uuid-to-name="wildcardUuidToName"
                    surface="wildcard"
                  />
                </template>
                <template #option="{ option }">
                  <RichTextPreview
                    :value="String(option.value) === '' ? option.label : String(option.value)"
                    :uuid-to-name="wildcardUuidToName"
                    surface="wildcard"
                  />
                </template>
              </Select>
            </td>
            <td>
              <Select
                :model-value="ex.target"
                :options="exceptionTgtOptions()"
                placeholder="Pick value"
                aria-label="Exception target value"
                data-test="cn-ex-tgt-select"
                @update:model-value="(v) => onExceptionTargetPick(idx, v as string)"
              >
                <template #label="{ option }">
                  <RichTextPreview
                    :value="String(option.value) === '' ? option.label : String(option.value)"
                    :uuid-to-name="wildcardUuidToName"
                    surface="wildcard"
                  />
                </template>
                <template #option="{ option }">
                  <RichTextPreview
                    :value="String(option.value) === '' ? option.label : String(option.value)"
                    :uuid-to-name="wildcardUuidToName"
                    surface="wildcard"
                  />
                </template>
              </Select>
            </td>
            <td>
              <Select
                :model-value="ex.mode"
                :options="MODE_OPTIONS"
                aria-label="Exception mode"
                data-test="cn-ex-mode-select"
                @update:model-value="(v) => setExceptionMode(idx, v as ConstraintMode)"
              >
                <!-- Trigger + dropdown items render the mode as a colored
                     chip (MODE_META) so the table reads as boost/reduce/
                     exclude/neutral at a glance, matching the matrix hues. -->
                <template #label="{ option }">
                  <span
                    class="cn-mode-chip"
                    :style="{ '--cn-mode-var': `var(${modeMeta(String(option.value)).cssVar})` }"
                  >
                    <span class="cn-mode-chip__glyph" aria-hidden="true">{{ modeMeta(String(option.value)).glyph }}</span>
                    {{ modeMeta(String(option.value)).label }}
                  </span>
                </template>
                <template #option="{ option }">
                  <span
                    class="cn-mode-chip"
                    :style="{ '--cn-mode-var': `var(${modeMeta(String(option.value)).cssVar})` }"
                  >
                    <span class="cn-mode-chip__glyph" aria-hidden="true">{{ modeMeta(String(option.value)).glyph }}</span>
                    {{ modeMeta(String(option.value)).label }}
                  </span>
                </template>
              </Select>
            </td>
            <td>
              <Input
                v-if="ex.mode === 'boost' || ex.mode === 'reduce'"
                :model-value="ex.factor"
                type="number"
                size="sm"
                aria-label="Exception factor"
                @update:model-value="(v) => (ex.factor = Number(v) || 0)"
              />
              <span v-else class="wp-dim wp-mono cn-dash">—</span>
            </td>
            <td>
              <Button
                size="sm"
                variant="ghost"
                icon="pi-trash"
                class="wp-btn--danger"
                aria-label="Remove exception"
                @click="removeException(idx)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
    </div>
    <!-- CascadeConfirmDialog: shown when entity has downstream refs. -->
    <CascadeConfirmDialog
      v-if="isEdit && props.id"
      :open="cascadeDialogOpen"
      kind="constraint"
      :id="props.id"
      action="delete"
      @confirmed="onCascadeDialogConfirmed"
      @cancelled="cascadeDialogOpen = false"
    />
    <!-- ConfirmDialog inside EditorFrame to keep template single-root;
         see WildcardEditor for the multi-root Transition explanation. -->
    <ConfirmDialog
      :visible="showConfirm"
      title="Discard unsaved changes?"
      body="You have unsaved edits. Leaving this page will discard them."
      confirm-label="Discard & leave"
      cancel-label="Stay"
      variant="danger"
      @confirm="onConfirmLeave"
      @cancel="onCancelLeave"
    />
  </EditorFrame>
</template>

<style scoped>
.wp-editor-used-by {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
.cn-pair {
  display: grid;
  grid-template-columns: 1fr 24px 1fr;
  grid-template-rows: auto auto auto;
  grid-template-areas:
    "src-label .     tgt-label"
    "src-input cross tgt-input"
    "src-hint  .     tgt-hint";
  column-gap: var(--wp-space-5);
  row-gap: var(--wp-space-2);
  align-items: center;
}
.cn-pair-label {
  font: 500 12px/1.2 var(--wp-font); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  color: var(--wp-text-muted);
}
.cn-pair-hint {
  font: 11px/1.3 var(--wp-font); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  color: var(--wp-text-dim);
}
.cn-cross {
  grid-area: cross;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--wp-text-dim);
}

/* ── Read-only lock pill (Rule matrix #actions when stranded) ──── */
.cn-lock-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: var(--wp-radius, 6px);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim);
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-text) 10%, transparent);
}
.cn-lock-pill .pi { font-size: 10px; }

/* ── Locked wildcard field (replaces the Select when stranded) ───
 *    Neutral by default (the live side of a broken pair); the dangling
 *    side adds --danger so the missing wildcard reads as the problem.
 *    Sized to sit in place of the Select's trigger button. */
.cn-locked {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 5px 10px;
  border-radius: var(--wp-radius, 6px);
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
  border: 1px solid var(--wp-border);
  cursor: not-allowed;
}
.cn-locked__icon { font-size: 12px; color: var(--wp-text-dim); flex-shrink: 0; }
.cn-locked__body { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.cn-locked__name {
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cn-locked__sub {
  font-family: var(--wp-font-mono, monospace);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}
.cn-locked--danger {
  background: color-mix(in srgb, var(--wp-danger) 6%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger) 30%, transparent);
}
.cn-locked--danger .cn-locked__icon { color: var(--wp-danger); }
.cn-col-mode { width: 150px; }
.cn-col-factor { width: 120px; }
.cn-col-trash { width: 40px; }
.cn-dash { font-size: var(--wp-text-xs); }

/* ── Exceptions table — colored mode chips + per-row accent ──────
 *    The Source/Target headers borrow the matrix's purple/cyan axis
 *    language so the table reads as "source value → target value".
 *    Each row carries a left accent + faint wash keyed to its mode
 *    (--cn-mode-var set inline from MODE_META) so boost/reduce/exclude
 *    rows are scannable; neutral falls back to the muted grey var. */
.cn-ex-th-src {
  color: var(--wp-constraint-source-text);
  text-transform: uppercase;
  font-size: var(--wp-text-xs);
  letter-spacing: 0.06em;
}
.cn-ex-th-tgt {
  color: var(--wp-constraint-target-text);
  text-transform: uppercase;
  font-size: var(--wp-text-xs);
  letter-spacing: 0.06em;
}
.cn-ex-row > td:first-child {
  border-left: 3px solid color-mix(in srgb, var(--cn-mode-var, var(--wp-border)) 60%, transparent);
}
.cn-ex-row {
  background: color-mix(in srgb, var(--cn-mode-var, transparent) 5%, transparent);
}

/* Mode chip — icon glyph + label, tinted by --cn-mode-var. Editable +
 * read-only share the base; the read-only modifier mutes it to the same
 * ~1/3 intensity the read-only matrix cells use. */
.cn-mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: var(--wp-text-xs);
  font-weight: 600;
  white-space: nowrap;
  color: var(--cn-mode-var, var(--wp-text-dim));
  background: color-mix(in srgb, var(--cn-mode-var, var(--wp-text-dim)) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--cn-mode-var, var(--wp-text-dim)) 36%, transparent);
}
.cn-mode-chip__glyph {
  font-family: var(--wp-font-mono, monospace);
  font-size: 13px;
  line-height: 1;
}
.cn-mode-chip--ro {
  color: color-mix(in srgb, var(--cn-mode-var, var(--wp-text-dim)) 70%, var(--wp-text-dim));
  background: color-mix(in srgb, var(--cn-mode-var, var(--wp-text-dim)) 8%, transparent);
  border-color: color-mix(in srgb, var(--cn-mode-var, var(--wp-text-dim)) 18%, transparent);
}

/* ── Target reach — segmented first / next N / all + stepper. Mirrors
 *    the instance modal's TargetReachSection control, restyled with the
 *    manager's tokens. `pick` is intentionally absent (instance-only). */
.cn-reach {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  align-items: flex-start;
}
.cn-reach-seg {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 6px);
  overflow: hidden;
}
.cn-reach-btn {
  padding: 6px 14px;
  border: 0;
  border-right: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-weight: 500;
  cursor: pointer;
}
.cn-reach-btn:last-of-type { border-right: 0; }
.cn-reach-btn:hover {
  color: var(--wp-text);
  background: color-mix(in srgb, var(--wp-text) 6%, transparent);
}
.cn-reach-btn.active {
  background: var(--wp-accent);
  color: #fff;
}
.cn-reach-step {
  display: inline-flex;
  align-items: stretch;
  border-left: 1px solid var(--wp-border);
}
.cn-reach-step__field {
  width: 44px;
  background: transparent;
  border: 0;
  padding: 0 8px;
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
  text-align: center;
  -moz-appearance: textfield;
}
.cn-reach-step__field::-webkit-outer-spin-button,
.cn-reach-step__field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cn-reach-step__field:focus { outline: none; }
/* Stacked up/down stepper — native spin buttons hidden above so these
 * don't double up. Mirrors the exceptions factor Input's spinner. */
.cn-reach-step__spin {
  display: flex;
  flex-direction: column;
  width: 18px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border);
}
.cn-reach-step__btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim);
  cursor: pointer;
  line-height: 0;
}
.cn-reach-step__btn + .cn-reach-step__btn { border-top: 1px solid var(--wp-border); }
.cn-reach-step__btn .pi { font-size: 8px; }
.cn-reach-step__btn:hover {
  color: var(--wp-text);
  background: color-mix(in srgb, var(--wp-text) 8%, transparent);
}
.cn-reach-hint {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}
</style>
