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
import DraftBanner from "../components/DraftBanner.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
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
import type {
  ConstraintCell,
  ConstraintException,
  ConstraintMatrix,
  ConstraintMode,
  ConstraintPayload,
  ModuleHistoryEntry,
  ModuleRow,
} from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const { resolveReturnTo } = useReturnTo();
const moduleStore = useModuleStore();
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
  if (cascadeRefs.value.length === 0) {
    const result = await cascadeApply.apply({
      kind: "constraint", id: props.id, action: "delete",
    });
    if (result.ok) {
      moduleStore.remove(props.id);
      const undoId = result.undo_entry_id;
      toast.push({
        severity: "success",
        summary: `"${name.value}" deleted`,
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
    } else {
      toast.push({ severity: "error", summary: "Delete failed", detail: (result as { ok: false; error: string }).error, life: 4000 });
    }
    return;
  }
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

interface WildcardOption { id: string; value: string; weight: number; sub_category?: string | null; }
interface WildcardPayloadShape {
  options?: WildcardOption[];
  sub_categories?: string[];
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const sourceWildcardId = ref<string | null>(null);
const targetWildcardId = ref<string | null>(null);
const matrix = ref<ConstraintMatrix>({});
const exceptions = ref<ConstraintException[]>([]);
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
    matrix: matrix.value,
    exceptions: exceptions.value,
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
      matrix: ConstraintMatrix;
      exceptions: ConstraintException[];
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    sourceWildcardId.value = parsed.sourceWildcardId;
    targetWildcardId.value = parsed.targetWildcardId;
    matrix.value = normalizeMatrix(parsed.matrix);
    exceptions.value = normalizeExceptions(parsed.exceptions);
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

// Matrix axes are BOTH sub-categories — source's on the rows, target's
// on the cols. Source-value-keyed cells (the prior shape) confused the
// "rule" semantics: a constraint matrix expresses category-level
// boost/exclude rules, not per-option overrides. Per-option overrides
// belong in the Exceptions table beneath the matrix.
const sourceSubCategories = computed<string[]>(() => {
  const wc = sourceWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  return payload.sub_categories ?? [];
});

const targetSubCategories = computed<string[]>(() => {
  const wc = targetWildcard.value;
  if (!wc) return [];
  const payload = wc.payload as WildcardPayloadShape;
  return payload.sub_categories ?? [];
});

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
  for (const ex of exceptions.value) {
    if (ex.source_id) {
      const current = srcById.get(ex.source_id);
      if (typeof current === "string" && current !== ex.source) {
        ex.source = current;
        changed = true;
      }
    }
    if (ex.target_id) {
      const current = tgtById.get(ex.target_id);
      if (typeof current === "string" && current !== ex.target) {
        ex.target = current;
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

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      const p = row.payload as Partial<ConstraintPayload>;
      sourceWildcardId.value = p.source_wildcard_id ?? null;
      targetWildcardId.value = p.target_wildcard_id ?? null;
      matrix.value = normalizeMatrix(p.matrix);
      exceptions.value = normalizeExceptions(p.exceptions);
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

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<ConstraintPayload>;
  sourceWildcardId.value = p.source_wildcard_id ?? null;
  targetWildcardId.value = p.target_wildcard_id ?? null;
  matrix.value = normalizeMatrix(p.matrix);
  exceptions.value = normalizeExceptions(p.exceptions);
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
      matrix: matrix.value,
      exceptions: exceptions.value,
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

defineExpose({ sourceWildcardId, targetWildcardId, matrix, exceptions, applyRestore, displayLabel });
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
        @update:tags="(v) => (tags = v)"
      />
    </div>

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
          <Select
            id="cn-source-select"
            :model-value="sourceWildcardId"
            :options="wildcardOptions"
            placeholder="Pick source"
            clearable
            data-test="source-wildcard-select"
            aria-label="Source wildcard"
            @update:model-value="(v) => { sourceWildcardId = v as string | null; matrix = {}; }"
          />
        </div>
        <div class="cn-cross"><i class="pi pi-times" /></div>
        <div style="grid-area: tgt-input">
          <Select
            id="cn-target-select"
            :model-value="targetWildcardId"
            :options="wildcardOptions"
            placeholder="Pick target"
            clearable
            data-test="target-wildcard-select"
            aria-label="Target wildcard"
            @update:model-value="(v) => { targetWildcardId = v as string | null; matrix = {}; }"
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
        <span class="wp-card__hint">Click cycles · cog tunes factor</span>
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
        <span v-if="sourceSubCategories.length === 0">Source wildcard needs at least one sub-category. </span>
        <span v-if="targetSubCategories.length === 0">Target wildcard needs at least one sub-category. </span>
        Add them on the wildcard editor to define rules.
      </div>
      <ConstraintMatrixGrid
        v-else
        :rows="sourceSubCategories"
        :cols="targetSubCategories"
        :model-value="matrix"
        data-test="matrix-grid"
        @update:model-value="onMatrixUpdate"
      />
    </Card>
    </div>

    <div id="editor-section-exceptions">
    <Card :title="`Exceptions (${exceptions.length})`" :padding="false">
      <template #actions>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="add-exception" @click="addException">
          Add exception
        </Button>
      </template>
      <div v-if="!exceptions.length" class="wp-empty-card">
        <i class="pi pi-info-circle" />
        Per-pair overrides for specific option values that the matrix doesn't cover.
      </div>
      <table v-else class="wp-table wp-options-table">
        <thead>
          <tr>
            <th>Source value</th>
            <th>Target value</th>
            <th class="cn-col-mode">Mode</th>
            <th class="cn-col-factor">Factor</th>
            <th class="cn-col-trash" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(ex, idx) in exceptions" :key="idx">
            <td>
              <Select
                :model-value="ex.source"
                :options="sourceValues.map((v) => ({ label: displayLabel(v), value: v }))"
                placeholder="Pick value"
                aria-label="Exception source value"
                @update:model-value="(v) => onExceptionSourcePick(idx, v as string)"
              />
            </td>
            <td>
              <Select
                :model-value="ex.target"
                :options="targetValues.map((v) => ({ label: displayLabel(v), value: v }))"
                placeholder="Pick value"
                aria-label="Exception target value"
                @update:model-value="(v) => onExceptionTargetPick(idx, v as string)"
              />
            </td>
            <td>
              <Select
                :model-value="ex.mode"
                :options="MODE_OPTIONS"
                aria-label="Exception mode"
                @update:model-value="(v) => setExceptionMode(idx, v as ConstraintMode)"
              />
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
.cn-col-mode { width: 130px; }
.cn-col-factor { width: 120px; }
.cn-col-trash { width: 40px; }
.cn-dash { font-size: var(--wp-text-xs); }
</style>
