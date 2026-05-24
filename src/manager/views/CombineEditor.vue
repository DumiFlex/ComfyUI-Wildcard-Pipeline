<script setup lang="ts">
/**
 * CombineEditor — Wave 4 port of `CombineEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity
 *  2. Template + output ($output_var input + RichTextInput multiline)
 *  3. Detected inputs chip list
 *  4. Live preview
 */
import { computed, onMounted, ref, watch } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState } from "../components/EditorFrame.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import DraftBanner from "../components/DraftBanner.vue";
import Field from "../components/ui/Field.vue";
import Chip from "../components/ui/Chip.vue";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import { tokenizeRich } from "../../widgets/richTokenize";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import { buildUuidToName } from "../utils/wildcardSyntax";
import { collectLibraryVarHints, type VarHint } from "../utils/library-suggestions";
import { appendSnapshot, readHistory } from "../utils/history";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import { registerCascadeUndo } from "../cascade/undo-stack-integration";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import CascadeRenameDialog from "../cascade/CascadeRenameDialog.vue";
import PillCountBadge from "../cascade/PillCountBadge.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { ResolveWarning } from "../utils/resolveTokens";
import type {
  CombinePayload,
  ModuleHistoryEntry,
} from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();
const recent = useRecentStore();
const { resolveReturnTo } = useReturnTo();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();
const resolveWarnings = useResolveWarnings();

const cascadeDialogOpen = ref(false);

// Rename dialog: opened when save detects outputVar changed on existing combine.
const outputVarRenameOpen = ref(false);
// The outputVar as it was last saved to the server (for rename detection).
const savedOutputVar = ref<string>("");
// Pending save args accumulated before the rename intercept.
const pendingSavePayload = ref<{ payload: CombinePayload; historyNext: ModuleHistoryEntry[] } | null>(null);

const cascadeRefs = computed(() => {
  if (!props.id) return [];
  return cascade.refsTo("combine", props.id);
});

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  if (cascadeRefs.value.length === 0) {
    const result = await cascadeApply.apply({
      kind: "combine", id: props.id, action: "delete",
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
      router.push(resolveReturnTo("/combines"));
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
  router.push(resolveReturnTo("/combines"));
}

async function onOutputVarRenameConfirmed(result: {
  undo_entry_id: string;
  broken_refs?: Array<{ kind: string; id: string; name: string }>;
}): Promise<void> {
  outputVarRenameOpen.value = false;

  // Register undo handle + show toast.
  const oldName = savedOutputVar.value;
  const undoHandle = registerCascadeUndo(result.undo_entry_id, `Renamed $${oldName}`);
  toast.push({
    severity: "success",
    summary: `Output variable renamed`,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await undoHandle.undo();
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          toast.push({ severity: "info", summary: `Rename reversed`, life: 3000 });
        }
      },
    },
  });

  // Push broken_refs if the user opted out of cascade.
  if (result.broken_refs?.length) {
    const warnings: ResolveWarning[] = result.broken_refs.map((ref) => ({
      type: "cascade_broken_ref",
      severity: "warn" as const,
      module_id: ref.id,
      source_field: "rename-opt-out",
      position: 0,
      token_index: null,
      detail: { rename_target_id: result.undo_entry_id, broken_ref_kind: ref.kind, broken_ref_name: ref.name },
      message: `Ref to renamed combine output_var may be broken (rename without cascade was selected)`,
    }));
    resolveWarnings.push(warnings);
  }

  // Proceed with the pending save now that the rename is committed server-side.
  if (pendingSavePayload.value && props.id) {
    const { payload, historyNext } = pendingSavePayload.value;
    pendingSavePayload.value = null;
    savedOutputVar.value = payload.output_var;
    setSaveState("saving");
    saving.value = true;
    try {
      await moduleStore.update(props.id, {
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        payload: { ...(payload as unknown as Record<string, unknown>), history: historyNext },
      });
      historyEntries.value = historyNext;
      recent.push({ id: props.id, kind: "combine", name: name.value });
      draft.discard();
      setSaveState("saved", 1500);
      baseline.value = snapshot();
      router.push(resolveReturnTo("/combines"));
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e);
      setSaveState("error", 3000);
      toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
    } finally {
      saving.value = false;
    }
  }
}

function onOutputVarRenameCancelled(): void {
  outputVarRenameOpen.value = false;
  pendingSavePayload.value = null;
  // User cancelled the rename dialog — restore saving state to idle.
  saving.value = false;
  setSaveState("idle");
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const template = ref("");
const outputVar = ref("");
const outputVarTouched = ref(false);
const outputVarError = ref("");
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
    template: template.value,
    outputVar: outputVar.value,
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

const draft = useEditorDraft({
  kind: "combine",
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
      template: string;
      outputVar: string;
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    template.value = parsed.template;
    outputVar.value = parsed.outputVar;
    outputVarTouched.value = true;
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

const PLACEHOLDER = "$first_name, a $age-year-old with $hair_color hair";

watch(name, (next) => {
  if (!outputVarTouched.value) {
    outputVar.value = toIdentifier(next);
  }
});

function onOutputVarInput(value: string) {
  outputVarTouched.value = true;
  outputVar.value = (value ?? "").replace(/^\$+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  if (outputVarError.value) outputVarError.value = "";
}

// Library var hints for the `$var` autocomplete dropdown — extracted
// to `utils/library-suggestions.ts` (2026-05-09 cycle) so combine,
// derivation, and wildcard editors share one walker. The kind tag on
// each hint feeds the autocomplete row's color hash.
const varHints = computed<VarHint[]>(
  () => collectLibraryVarHints(moduleStore, props.id),
);

const varSuggestions = computed<string[]>(() => varHints.value.map((h) => h.label));
// Surfaces `@{uuid}` chips with human var-names in template + preview.
// Combine surface ignores `@` refs at resolve time, but stray UUIDs
// pasted in still benefit from the labelled chip.
const uuidToName = computed(() => buildUuidToName(moduleStore.catalog));
const hintByLabel = computed<Map<string, VarHint>>(() => {
  const m = new Map<string, VarHint>();
  for (const h of varHints.value) m.set(h.label, h);
  return m;
});

const detected = computed<string[]>(() => {
  const tokens = tokenizeRich(template.value);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.kind === "var" && t.meta?.name) {
      if (!seen.has(t.meta.name)) { seen.add(t.meta.name); out.push(t.meta.name); }
    }
  }
  return out;
});

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      const p = row.payload as Partial<CombinePayload>;
      template.value = p.template ?? "";
      const o = (p.output_var ?? "").replace(/^\$+/, "");
      if (o.trim()) {
        outputVar.value = o;
        outputVarTouched.value = true;
      } else {
        outputVar.value = toIdentifier(row.name);
      }
      savedOutputVar.value = outputVar.value;
      historyEntries.value = readHistory(row.payload);
      recent.push({ id: props.id, kind: "combine", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Combine not found" });
      router.replace("/combines");
    }
  }
  baseline.value = snapshot();
});

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<CombinePayload>;
  template.value = p.template ?? "";
  const o = (p.output_var ?? "").replace(/^\$+/, "");
  if (o.trim()) {
    outputVar.value = o;
    outputVarTouched.value = true;
  } else {
    outputVar.value = toIdentifier(entry.name);
    outputVarTouched.value = false;
  }
  toast.push({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  if (!name.value.trim()) {
    toast.push({ severity: "warn", summary: "Name required" });
    return;
  }
  const finalOutput = outputVar.value.trim() || toIdentifier(name.value);
  if (!VALID_IDENTIFIER_RE.test(finalOutput)) {
    outputVarError.value = "Use letters, digits, underscores; must not start with a digit.";
    toast.push({ severity: "warn", summary: "Invalid output variable" });
    return;
  }
  outputVarError.value = "";
  setSaveState("saving");
  saving.value = true;
  try {
    const payload: CombinePayload = {
      template: template.value,
      output_var: finalOutput,
      input_vars: [...detected.value],
    };
    const newPayload = payload as unknown as Record<string, unknown>;
    if (isEdit.value && props.id) {
      // Rename intercept: if the output_var changed, open CascadeRenameDialog
      // so the user can cascade-update all downstream references before saving.
      // The rename dialog calls cascade-apply on the server; after confirmed we
      // proceed with the regular moduleStore.update below.
      if (finalOutput !== savedOutputVar.value && savedOutputVar.value) {
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
        pendingSavePayload.value = { payload, historyNext: nextHistory };
        setSaveState("idle");
        saving.value = false;
        outputVarRenameOpen.value = true;
        return;
      }
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
      recent.push({ id: props.id, kind: "combine", name: name.value });
    } else {
      // New mode: the new row id is not surfaced here; mount-time push fires
      // next time the user opens this item.
      await moduleStore.create({
        type: "combine",
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
    router.push(resolveReturnTo("/combines"));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/combines")); }

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/combines", label: "Combines" },
  { label: isEdit.value ? (name.value || "Editing") : "New combine" },
]);
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit combine' : 'New combine'"
    back-route="/combines"
    back-label="Combines"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :save-state="saveState"
    :save-error="saveError"
    :dirty="dirty"
    :history-entries="historyEntries"
    @save="save"
    @cancel="cancel"
    @restore="applyRestore"
  >
    <template #draft-banner>
      <DraftBanner
        :has-draft="draft.hasDraft.value"
        :age-ms="draft.draftAge.value"
        @restore="applyDraft"
        @discard="draft.discard"
      />
    </template>
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
        data-test="cb-delete-btn"
        @click="onEntityDeleteClick"
      >Delete</Button>
    </template>
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

    <Card title="Template & Output">
      <div class="cb-grid">
        <Field
          label="Template"
          hint="Reference variables with $name. Use $$ for a literal $. Use {a|b|c} for inline choices."
        >
          <RichTextInput
            v-model="template"
            :var-suggestions="varSuggestions"
            :uuid-to-name="uuidToName"
            :multiline="true"
            :rows="3"
            :placeholder="PLACEHOLDER"
            data-test="cb-template"
            aria-label="Combine template"
          />
        </Field>
        <Field
          label="Output variable"
          hint="Downstream modules read this name."
          :error="outputVarError"
        >
          <div class="wp-input-group">
            <span class="wp-input-group__addon">$</span>
            <input
              class="wp-input"
              :value="outputVar"
              placeholder="subject_phrase"
              data-test="cb-output-var"
              @input="onOutputVarInput(($event.target as HTMLInputElement).value)"
            />
          </div>
        </Field>
      </div>
      <div class="cb-detected">
        <div class="wp-field__label cb-detected__label">Detected inputs ({{ detected.length }})</div>
        <span v-if="!detected.length" class="wp-dim cb-detected__hint">
          None — type a template above.
        </span>
        <div v-else class="cb-detected__chips" data-test="cb-detected">
          <Chip
            v-for="d in detected"
            :key="d"
            tone="accent"
            icon="tag"
          >${{ d }}<span v-if="!hintByLabel.get(d)" class="cb-detected__warn"> ?</span></Chip>
        </div>
      </div>
    </Card>

    <Card title="Preview">
      <div class="wp-snippet" data-test="cb-preview">
        <div><span class="wp-token-com">// Highlighted template syntax:</span></div>
        <div class="cb-preview__row">
          <RichTextPreview
            v-if="template"
            :value="template"
            :uuid-to-name="uuidToName"
          />
          <span v-else class="wp-dim">(empty template)</span>
        </div>
        <div>
          <span class="wp-token-com">→ stored as </span>
          <span class="wp-token-var">${{ outputVar || "output" }}</span>
        </div>
      </div>
    </Card>
    <!-- CascadeConfirmDialog: shown when entity has downstream refs. -->
    <CascadeConfirmDialog
      v-if="isEdit && props.id"
      :open="cascadeDialogOpen"
      kind="combine"
      :id="props.id"
      action="delete"
      @confirmed="onCascadeDialogConfirmed"
      @cancelled="cascadeDialogOpen = false"
    />
    <!-- CascadeRenameDialog: intercepts save when output_var changes on
         an existing combine. Cascades the rename to all downstream refs. -->
    <CascadeRenameDialog
      v-if="isEdit && props.id && savedOutputVar"
      :open="outputVarRenameOpen"
      kind="combine_output_var"
      :id="props.id"
      :extra="{ old_name: savedOutputVar }"
      :initial-name="outputVar"
      @confirmed="onOutputVarRenameConfirmed"
      @cancelled="onOutputVarRenameCancelled"
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
.cb-grid {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: var(--wp-space-5);
}
.cb-detected {
  margin-top: var(--wp-space-5);
}
.cb-detected__label { margin-bottom: var(--wp-space-3); }
.cb-detected__hint { font-size: var(--wp-text-sm); }
.cb-detected__chips {
  display: flex;
  gap: var(--wp-space-3);
  flex-wrap: wrap;
}
.cb-detected__warn { color: var(--wp-warn); margin-left: var(--wp-space-2); }
.cb-preview__row {
  margin-top: var(--wp-space-2);
  margin-bottom: var(--wp-space-4);
}
</style>
