<script setup lang="ts">
/**
 * DerivationEditor — Wave 4 port of `DerivationEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity
 *  2. Rules list (DerivationRuleCard, with add/remove)
 */
import { computed, onMounted, ref } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState } from "../components/EditorFrame.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import DraftBanner from "../components/DraftBanner.vue";
import DerivationRuleCard from "../components/DerivationRuleCard.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useRecentStore } from "../stores/recentStore";
import { useCategoryStore } from "../stores/categoryStore";
import { appendSnapshot, readHistory } from "../utils/history";
import {
  buildWildcardRefData,
  collectLibraryVarHints,
  collectLibraryWildcardRefs,
} from "../utils/library-suggestions";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import PillCountBadge from "../cascade/PillCountBadge.vue";
import type {
  DerivationAction,
  DerivationBranch,
  DerivationElse,
  DerivationPayload,
  DerivationRule,
  ModuleHistoryEntry,
} from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const currentRow = computed(() =>
  props.id ? moduleStore.catalog.find((m) => m.id === props.id) ?? null : null,
);
const { resolveReturnTo } = useReturnTo();
const categoryStore = useCategoryStore();
const toast = useToast();
const recent = useRecentStore();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();

const cascadeDialogOpen = ref(false);

const cascadeRefs = computed(() => {
  if (!props.id) return [];
  return cascade.refsTo("derivation", props.id);
});

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  // Always confirm — see WildcardEditor for the rationale.
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
  router.push(resolveReturnTo("/derivations"));
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const contentRating = ref<"safe" | "nsfw">("safe");
const rules = ref<DerivationRule[]>([]);
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
    rules: rules.value,
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

const draft = useEditorDraft({
  kind: "derivation",
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
      rules: DerivationRule[];
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    rules.value = Array.isArray(parsed.rules) ? parsed.rules.map(migrateRule) : [];
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

// Library var hints for the `$`-trigger autocomplete dropdown — pulls
// from every wildcard / fixed_values / combine in the catalog except
// the rule's own derivation. Extracted to `utils/library-suggestions.ts`
// (2026-05-09 cycle) so combine + derivation + wildcard editors share
// one walker. RichTextInput expects a string array, so we drop the
// kind-tag here.
const varSuggestions = computed<string[]>(
  () => collectLibraryVarHints(moduleStore, props.id).map((h) => h.label),
);

// Wildcard-ref data (display names + the sub-cat picker maps) built ONCE from
// the catalog by the shared `buildWildcardRefData` walker — the SAME source
// the wildcard editor uses. Forwarded to each DerivationRuleCard so ACTION
// values reuse the wildcard `@{}` nested-ref machinery (autocomplete + chips
// + step-2 picker). `@{}` resolves on the derivation surface as a carrier
// post-Layer-A (engine/syntax/resolve.py); condition values stay raw.
const refData = computed(() => buildWildcardRefData(moduleStore.catalog));
const uuidToName = computed(() => refData.value.uuidToName);
const refSuggestions = computed(() =>
  collectLibraryWildcardRefs(moduleStore, props.id, refData.value.uuidToName),
);

let ruleSeq = 0;
function newRuleId(): string {
  ruleSeq += 1;
  return `r_${Date.now().toString(36)}_${ruleSeq}`;
}

function blankAction(): DerivationAction {
  return { target_var: "", mode: "replace", value: "" };
}
function blankBranch(): DerivationBranch {
  return {
    condition: { var: "", op: "equals", value: "" },
    action: blankAction(),
  };
}
function blankRule(): DerivationRule {
  return { id: newRuleId(), branches: [blankBranch()] };
}

function migrateRule(raw: unknown): DerivationRule {
  const r = (raw ?? {}) as Partial<DerivationRule> & {
    else?: Partial<DerivationElse> | DerivationAction | null;
  };
  const id = typeof r.id === "string" && r.id ? r.id : newRuleId();
  const branchesIn = Array.isArray(r.branches) ? r.branches : [];
  const branches: DerivationBranch[] = branchesIn.length
    ? branchesIn.map((b) => migrateBranch(b))
    : [blankBranch()];
  const out: DerivationRule = { id, branches };
  if (r.else && typeof r.else === "object") {
    const wrapped = (r.else as Partial<DerivationElse>).action;
    const action = wrapped
      ? migrateAction(wrapped)
      : migrateAction(r.else as Partial<DerivationAction>);
    out.else = { action };
  }
  return out;
}

function migrateBranch(raw: unknown): DerivationBranch {
  const b = (raw ?? {}) as Partial<DerivationBranch>;
  const cIn = (b.condition ?? {}) as Record<string, unknown>;
  const aIn = (b.action ?? {}) as Record<string, unknown>;
  const op = typeof cIn.op === "string" ? cIn.op : "equals";
  return {
    condition: {
      var: typeof cIn.var === "string" ? cIn.var : "",
      op: (op === "equals" || op === "not_equals" || op === "contains" || op === "matches"
        ? op
        : "equals") as DerivationBranch["condition"]["op"],
      value: typeof cIn.value === "string" ? cIn.value : "",
    },
    action: migrateAction(aIn),
  };
}

function migrateAction(raw: unknown): DerivationAction {
  const a = (raw ?? {}) as Record<string, unknown>;
  const target =
    typeof a.target_var === "string"
      ? a.target_var
      : typeof a.target === "string"
        ? a.target
        : "";
  const mode = typeof a.mode === "string" ? a.mode : "replace";
  return {
    target_var: target,
    mode: (mode === "replace" || mode === "append" || mode === "prepend"
      ? mode
      : "replace") as DerivationAction["mode"],
    value: typeof a.value === "string" ? a.value : "",
  };
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
      const p = row.payload as Partial<DerivationPayload>;
      const incoming = Array.isArray(p.rules) ? p.rules : [];
      rules.value = incoming.length ? incoming.map(migrateRule) : [];
      historyEntries.value = readHistory(row.payload);
      recent.push({ id: props.id, kind: "derivation", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Derivation not found" });
      router.replace("/derivations");
    }
  }
  baseline.value = snapshot();
});

function addRule() {
  rules.value = [...rules.value, blankRule()];
}
function removeRule(idx: number) {
  rules.value = rules.value.filter((_, i) => i !== idx);
}
function updateRule(idx: number, value: DerivationRule) {
  rules.value = rules.value.map((r, i) => (i === idx ? value : r));
}

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<DerivationPayload>;
  const incoming = Array.isArray(p.rules) ? p.rules : [];
  rules.value = incoming.length ? incoming.map(migrateRule) : [];
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
  setSaveState("saving");
  saving.value = true;
  try {
    const payload: DerivationPayload = { rules: rules.value };
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
      recent.push({ id: props.id, kind: "derivation", name: name.value });
    } else {
      // New mode: the new row id is not surfaced here; mount-time push fires
      // next time the user opens this item.
      await moduleStore.create({
        type: "derivation",
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
    router.push(resolveReturnTo("/derivations"));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/derivations")); }

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/derivations", label: "Derivations" },
  { label: isEdit.value ? (name.value || "Editing") : "New derivation" },
]);

defineExpose({ rules, addRule, removeRule, applyRestore });
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit derivation' : 'New derivation'"
    back-route="/derivations"
    back-label="Derivations"
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
        data-test="dr-delete-btn"
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
      :content-rating="contentRating"
      @update:tags="(v) => (tags = v)"
      @update:content-rating="(v) => (contentRating = v)"
    />

    <Card :title="`Rules (${rules.length})`">
      <template #actions>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="add-rule" @click="addRule">
          Add rule
        </Button>
      </template>
      <p class="wp-card__hint">
        Each rule runs independently. Inside a rule, branches evaluate top-to-bottom — the first matching IF/ELIF wins; the optional ELSE only fires when no branch matched.
      </p>

      <div v-if="rules.length === 0" class="wp-empty-card" data-test="rules-empty">
        No rules yet. Click <strong>Add rule</strong> to start defining IF / ELIF / ELSE behaviour.
      </div>

      <div v-else class="rules-stack" data-test="rules-stack">
        <DerivationRuleCard
          v-for="(rule, idx) in rules"
          :key="rule.id"
          :model-value="rule"
          :index="idx"
          :var-suggestions="varSuggestions"
          :uuid-to-name="uuidToName"
          :ref-suggestions="refSuggestions"
          :uuid-to-sub-categories="refData.uuidToSubCategories"
          :uuid-to-has-null="refData.uuidToHasNull"
          :uuid-to-options-count="refData.uuidToOptionsCount"
          :uuid-to-option-tag-sets="refData.uuidToOptionTagSets"
          :uuid-to-tag-groups="refData.uuidToTagGroups"
          :default-collapsed="rules.length > 1"
          :data-test="`rule-${idx}`"
          @update:model-value="(v) => updateRule(idx, v)"
          @remove="removeRule(idx)"
        />
      </div>
    </Card>
    <!-- CascadeConfirmDialog: shown when entity has downstream refs. -->
    <CascadeConfirmDialog
      v-if="isEdit && props.id"
      :open="cascadeDialogOpen"
      kind="derivation"
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
.rules-stack {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}
</style>
