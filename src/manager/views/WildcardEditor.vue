<script setup lang="ts">
/**
 * WildcardEditor — Wave 4 port of `WildcardEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity (name + category + description + tags + `$varBinding`)
 *  2. Sub-categories chip list
 *  3. Options table (weight + value RichTextInput + sub-category Select)
 *
 * Save flow appends a snapshot to `payload.history` (utils/history.ts) so
 * the EditorFrame's history button works on the next mount.
 */
import { computed, onMounted, ref } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState, EditorFieldError } from "../components/EditorFrame.types";
import { useRouter, useRoute } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import Chip from "../components/ui/Chip.vue";
import RichTextInput from "../components/RichTextInput.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import DraftBanner from "../components/DraftBanner.vue";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import {
  collectLibraryWildcardRefs,
} from "../utils/library-suggestions";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  ModuleHistoryEntry,
  WildcardOption,
  WildcardPayload,
} from "../api/types";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import { registerCascadeUndo } from "../cascade/undo-stack-integration";
import PillCountBadge from "../cascade/PillCountBadge.vue";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import CascadeRenameDialog from "../cascade/CascadeRenameDialog.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { ResolveWarning } from "../utils/resolveTokens";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const route = useRoute();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();
const recent = useRecentStore();
const { resolveReturnTo } = useReturnTo();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();

/**
 * Live library row for the entity being edited. Resolves through
 * `moduleStore.catalog` so per-row footer actions (publish to
 * community, copy payload) get the same engine-row shape every
 * other code path uses. Null on create or when the row hasn't yet
 * hydrated.
 */
const currentRow = computed(() => {
  if (!props.id) return null;
  return moduleStore.catalog.find((m) => m.id === props.id) ?? null;
});
const resolveWarnings = useResolveWarnings();

const cascadeDialogOpen = ref(false);
const cascadeDialogProps = ref<{
  kind: string;
  id: string;
  action: "delete" | "rename";
  extra?: Record<string, unknown>;
} | null>(null);

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  // Always go through the cascade dialog — even when there are no
  // inbound refs. Earlier the no-refs branch deleted directly without
  // any prompt; that bit users who clicked the editor's Delete pill
  // by accident on a freshly-installed entity. The dialog runs its
  // own dry-run, so 0 refs just shows an empty "affected" list with
  // the Delete button still front-and-center — adds a 100ms scan but
  // guarantees confirm-before-destroy on every editor.
  cascadeDialogProps.value = {
    kind: "wildcard",
    id: props.id,
    action: "delete",
  };
  cascadeDialogOpen.value = true;
}

// Rename dialog for sub-category pills
const subcatRenameOpen = ref(false);
const subcatRenameTarget = ref<string>("");

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const contentRating = ref<"safe" | "nsfw">("safe");
const varBinding = ref("");
const varBindingError = ref("");
const subCategories = ref<string[]>([]);
const subDraft = ref("");
const options = ref<WildcardOption[]>([
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1 },
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1 },
]);
const saving = ref(false);
const saveState = ref<SaveState>("idle");
const saveError = ref<string>("");
let saveStateTimer: ReturnType<typeof setTimeout> | null = null;

/** Flip the Save button state-machine. `ttl` (ms) auto-resets the
 *  saved/error flash back to "idle" if nothing else has touched the
 *  state in the meantime. */
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
    varBinding: varBinding.value,
    subCategories: subCategories.value,
    options: options.value,
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

const draft = useEditorDraft({
  kind: "wildcard",
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
      varBinding: string;
      subCategories: string[];
      options: typeof options.value;
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    varBinding.value = parsed.varBinding;
    subCategories.value = parsed.subCategories;
    options.value = parsed.options;
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

// Suggestions: every other wildcard's id (= 8-hex uuid post DB
// migration 004) for the `@`-trigger nested-reference autocomplete.
// The canonical stored form is `@{8hex}` per the syntax spec — the
// popover surfaces the human display name (via `nameByUuid`) but
// the inserted token is the bare 8-hex id. The id IS the uuid, so
// no extraction step is needed.
//
// Walker extracted to `utils/library-suggestions.ts` (2026-05-09 cycle)
// so derivation editor + future SPA views inherit the same picker.
const wcSuggestions = computed<string[]>(
  () => collectLibraryWildcardRefs(moduleStore, props.id, nameByUuid.value),
);

// UUID → display-name map used by RichTextInput to render `@{uuid}`
// chips and the `@`-trigger autocomplete popover with human labels.
// Keyed by `mod.id` (= 8-hex uuid) so the popover, the inline chip,
// and the resolver all agree on identity.
const nameByUuid = computed<Map<string, string>>(() => {
  const m = new Map<string, string>();
  for (const mod of moduleStore.catalog) {
    if (mod.type !== "wildcard") continue;
    const p = (mod.payload ?? {}) as { var_binding?: string };
    const display = (p.var_binding && p.var_binding.trim()) || toIdentifier(mod.name);
    if (display) m.set(mod.id, display);
  }
  return m;
});

// UUID → sub_categories[] map used by RichTextInput's step-2 picker
// to surface the chosen wildcard's declared sub-category filters.
// Wildcards without declared sub_categories map to an empty array so
// the picker can still distinguish "known empty" from "missing entry".
const uuidToSubCategories = computed<Map<string, string[]>>(() => {
  const out = new Map<string, string[]>();
  for (const mod of moduleStore.catalog) {
    if (mod.type !== "wildcard") continue;
    const subs = (mod.payload as { sub_categories?: unknown } | undefined)?.sub_categories;
    if (Array.isArray(subs)) {
      out.set(mod.id, subs.filter((s): s is string => typeof s === "string"));
    } else {
      out.set(mod.id, []);
    }
  }
  return out;
});

/** Per-wildcard option count — drives the autocomplete row's right-
 *  side meta so two same-named wildcards (e.g. dupes from import) can
 *  be told apart by `N opts · 8hex` instead of looking identical. */
const uuidToOptionsCount = computed<Map<string, number>>(() => {
  const out = new Map<string, number>();
  for (const mod of moduleStore.catalog) {
    if (mod.type !== "wildcard") continue;
    const opts = (mod.payload as { options?: unknown[] } | undefined)?.options;
    out.set(mod.id, Array.isArray(opts) ? opts.length : 0);
  }
  return out;
});

/** Per-wildcard flag: true when the catalog row has an is_null option.
 *  Forwarded to RichTextInput so the nested-ref sub-cat picker can
 *  surface the "Include null" checkbox. */
const uuidToHasNull = computed<Map<string, boolean>>(() => {
  const out = new Map<string, boolean>();
  for (const mod of moduleStore.catalog) {
    if (mod.type !== "wildcard") continue;
    const opts = (mod.payload as { options?: unknown[] } | undefined)?.options;
    const has = Array.isArray(opts)
      && opts.some((o) => (o as { is_null?: boolean } | null)?.is_null === true);
    out.set(mod.id, has);
  }
  return out;
});

// Var-suggestions removed: wildcard option values don't support $name
// substitution at runtime (only @{uuid} nested refs + {a|b|c} inline
// choices). RichTextInput's surface="wildcard" gates the $-trigger
// popover so even pasted `$name` text stays plain.

const subCategoryOptions = computed(() => [
  { value: "", label: "(none)" },
  ...subCategories.value.map((s) => ({ value: s, label: s })),
]);

const totalWeight = computed(() => {
  const sum = options.value.reduce((acc, o) => acc + (Number(o.weight) || 0), 0);
  return sum > 0 ? sum : 1;
});

function probabilityFor(o: WildcardOption): number {
  return ((Number(o.weight) || 0) / totalWeight.value) * 100;
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
      const p = row.payload as Partial<WildcardPayload>;
      options.value = (p.options ?? []).map((o) => ({ ...o }));
      subCategories.value = [...(p.sub_categories ?? [])];
      varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(row.name);
      historyEntries.value = readHistory(row.payload);
      recent.push({ id: props.id, kind: "wildcard", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Wildcard not found" });
      router.replace("/wildcards");
    }
  } else if (route.query.starter === "subject") {
    // Quick-create starter: pre-fill a ready-to-save "subject" wildcard so a
    // brand-new user lands in an editor with something concrete to tweak + save.
    name.value = "subject";
    varBinding.value = "subject";
    options.value = [
      { id: _newOptionId(), value: "a cat", weight: 1 },
      { id: _newOptionId(), value: "a dog", weight: 1 },
      { id: _newOptionId(), value: "a fox", weight: 1 },
    ];
  }
  baseline.value = snapshot();
});

function addSub() {
  const s = subDraft.value.trim();
  if (!s) return;
  if (subCategories.value.includes(s)) {
    toast.push({ severity: "warn", summary: "Duplicate sub-category" });
    return;
  }
  // Sub-category names sit in the comma-separated `:subcat` segment
  // of nested refs (`@{uuid:warm,cool}`). Reject the same grammar-
  // reserved char set the wildcard name validator uses — comma is
  // additionally forbidden here because it's the list separator.
  const bad = s.match(/[{}:#@,]/);
  if (bad) {
    toast.push({
      severity: "warn",
      summary: `Sub-category cannot contain "${bad[0]}"`,
      detail: "Reserved by the @{uuid:subcat,subcat} ref grammar",
    });
    return;
  }
  if (s === "null") {
    toast.push({
      severity: "warn",
      summary: "Sub-category cannot be \"null\"",
      detail: "Reserved keyword in the @{uuid:subcat} filter",
    });
    return;
  }
  subCategories.value.push(s);
  subDraft.value = "";
}

function removeSub(s: string) {
  subCategories.value = subCategories.value.filter((x) => x !== s);
  for (const o of options.value) if (o.sub_category === s) o.sub_category = null;
}

async function onSubcatDeleteClick(subcat: string): Promise<void> {
  // Only the cascade flow matters for saved wildcards (props.id).
  // For new wildcards (no id yet) the subcat is local-only — delegate
  // straight to the existing in-memory removeSub.
  if (!props.id) {
    removeSub(subcat);
    return;
  }
  const refs = cascade.subcatRefsTo(props.id, subcat);
  if (refs.length === 0) {
    // Silent path: apply via cascade (server cleans any stale refs),
    // then remove from local draft state + show Undo toast.
    const result = await cascadeApply.apply({
      kind: "subcategory",
      id: props.id,
      action: "delete",
      extra: { subcat_name: subcat },
    });
    if (result.ok) {
      removeSub(subcat);
      baseline.value = snapshot();
      const undoId = result.undo_entry_id;
      toast.push({
        severity: "success",
        summary: `Sub-category "${subcat}" deleted`,
        life: 5000,
        action: {
          label: "Undo",
          run: async () => {
            const undoResult = await cascadeApply.undo(undoId);
            if (!undoResult.ok) {
              toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
            } else {
              // Re-add the subcat to the local draft if undo succeeded.
              if (!subCategories.value.includes(subcat)) {
                subCategories.value.push(subcat);
              }
              baseline.value = snapshot();
              toast.push({ severity: "info", summary: `Sub-category "${subcat}" restored`, life: 3000 });
            }
          },
        },
      });
    } else {
      toast.push({ severity: "error", summary: "Delete failed", detail: (result as { ok: false; error: string }).error, life: 4000 });
    }
    return;
  }
  // Refs > 0 path: open the confirm dialog so the user sees the impact.
  cascadeDialogProps.value = {
    kind: "subcategory",
    id: props.id,
    action: "delete",
    extra: { subcat_name: subcat },
  };
  cascadeDialogOpen.value = true;
}

function onCascadeDialogConfirmed(result: { undo_entry_id: string; affected_count: number }): void {
  cascadeDialogOpen.value = false;
  const dialogProps = cascadeDialogProps.value;
  if (!dialogProps) return;
  const undoId = result.undo_entry_id;
  const count = result.affected_count;

  if (dialogProps.kind === "wildcard") {
    // Whole-entity delete confirmed from the cascade dialog.
    moduleStore.remove(dialogProps.id);
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
    router.push(resolveReturnTo("/wildcards"));
    return;
  }
  if (dialogProps.kind === "option") {
    const rowIdx = dialogProps.extra?._row_idx as number | undefined;
    const optionId = dialogProps.id;
    const optSnapshot = typeof rowIdx === "number" ? options.value[rowIdx] : undefined;
    const optionLabel = optSnapshot?.value || optionId;
    if (typeof rowIdx === "number") options.value.splice(rowIdx, 1);
    baseline.value = snapshot();
    toast.push({
      severity: "success",
      summary: `Option "${optionLabel}" deleted`,
      detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
      life: 5000,
      action: {
        label: "Undo",
        run: async () => {
          const undoResult = await cascadeApply.undo(undoId);
          if (!undoResult.ok) {
            toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
          } else if (optSnapshot && typeof rowIdx === "number") {
            // Splice the option back at its original index.
            const insertAt = Math.min(rowIdx, options.value.length);
            options.value.splice(insertAt, 0, optSnapshot);
            baseline.value = snapshot();
            toast.push({ severity: "info", summary: `Option "${optionLabel}" restored`, life: 3000 });
          }
        },
      },
    });
    return;
  }

  // Default: sub-category delete path
  const subcat = (dialogProps.extra?.subcat_name as string | undefined) ?? "";
  if (subcat) removeSub(subcat);
  baseline.value = snapshot();
  toast.push({
    severity: "success",
    summary: `Sub-category "${subcat}" deleted`,
    detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await cascadeApply.undo(undoId);
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          if (subcat && !subCategories.value.includes(subcat)) {
            subCategories.value.push(subcat);
          }
          baseline.value = snapshot();
          toast.push({ severity: "info", summary: `Sub-category "${subcat}" restored`, life: 3000 });
        }
      },
    },
  });
}

function onCascadeDialogCancelled(): void {
  cascadeDialogOpen.value = false;
}

function onSubcatRenameClick(subcat: string): void {
  // Only meaningful for saved wildcards — new items have no server entity.
  if (!props.id) return;
  subcatRenameTarget.value = subcat;
  subcatRenameOpen.value = true;
}

function _applySubcatRename(oldName: string, newName: string): void {
  // Mirror the server-side `fix_subcat_rename` mutation on the local
  // draft state so the pills + option dropdowns reflect the new name
  // without a refetch. Touches top-level list AND singular per-option
  // assignment — same two sites the engine fixer updates.
  subCategories.value = subCategories.value.map((s) => (s === oldName ? newName : s));
  for (const o of options.value) {
    if (o.sub_category === oldName) o.sub_category = newName;
  }
}

function onSubcatRenameConfirmed(result: {
  undo_entry_id: string;
  new_name: string;
  broken_refs?: Array<{ kind: string; id: string; name: string }>;
}): void {
  subcatRenameOpen.value = false;
  const oldSubcat = subcatRenameTarget.value;
  const newSubcat = result.new_name;

  // Sync local state with server mutation, then re-anchor the dirty
  // baseline so the "Unsaved" badge stays clean (cascade already
  // persisted the rename server-side).
  _applySubcatRename(oldSubcat, newSubcat);
  baseline.value = snapshot();

  // Register undo handle and show toast with Undo action.
  const undoHandle = registerCascadeUndo(result.undo_entry_id, `Renamed sub-category "${oldSubcat}"`);
  toast.push({
    severity: "success",
    summary: `Sub-category renamed to "${newSubcat}"`,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await undoHandle.undo();
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          // Reverse the local rename to match the restored server state.
          _applySubcatRename(newSubcat, oldSubcat);
          baseline.value = snapshot();
          toast.push({ severity: "info", summary: `Sub-category rename reversed`, life: 3000 });
        }
      },
    },
  });

  // Push any broken refs (user opted out of cascade) into the warnings store.
  if (result.broken_refs?.length) {
    const warnings: ResolveWarning[] = result.broken_refs.map((ref) => ({
      type: "cascade_broken_ref",
      severity: "warn" as const,
      module_id: ref.id,
      source_field: "rename-opt-out",
      position: 0,
      token_index: null,
      detail: { rename_target_id: result.undo_entry_id, broken_ref_kind: ref.kind, broken_ref_name: ref.name },
      message: `Ref to renamed sub-category may be broken (rename without cascade was selected)`,
    }));
    resolveWarnings.push(warnings);
  }
}

function onSubcatRenameCancelled(): void {
  subcatRenameOpen.value = false;
}

function _newOptionId(): string {
  // 8-hex matches the server-side backfill in `ModuleRepository._backfill_option_ids`.
  // Two random ints concatenated to dodge the .slice(2, 8) yielding 6-7 chars.
  const a = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  const b = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${a}${b}`;
}

function addOption() {
  options.value.push({ id: _newOptionId(), value: "", weight: 1 });
}

/** Returns true when the options list already contains a null option. */
const hasNullOption = computed<boolean>(
  () => options.value.some((o) => o.is_null === true),
);

/** Add the single permitted null option to the wildcard. The null
 *  option carries `value: ""`, no `sub_category`, and `is_null: true`;
 *  when the wildcard rolls it the engine emits an empty string —
 *  a probabilistic "no output" slot. Idempotent: no-op if one
 *  already exists. New entries land at index 0 so the editor's natural
 *  top-down read surfaces the special row first. */
function addNullOption(): void {
  if (hasNullOption.value) return;
  options.value = [
    {
      id: _newOptionId(),
      value: "",
      weight: 1,
      sub_category: null,
      is_null: true,
    },
    ...options.value,
  ];
}

/** Move the null option (if any) to index 0. Called from the save
 *  path so serialised payloads always have null first regardless of
 *  whatever drag-sort the user did mid-edit. */
function hoistNullFirst<T extends { is_null?: boolean }>(list: T[]): T[] {
  const idx = list.findIndex((o) => o.is_null === true);
  if (idx <= 0) return list;
  const out = [...list];
  const [n] = out.splice(idx, 1);
  out.unshift(n);
  return out;
}

async function removeOption(idx: number): Promise<void> {
  const opt = options.value[idx];
  if (!opt) return;
  // Unsaved wildcard or option without id → splice locally, no cascade.
  if (!props.id || typeof opt.id !== "string" || !opt.id) {
    options.value.splice(idx, 1);
    return;
  }
  const refs = cascade.optionRefsTo(opt.id);
  if (refs.length === 0) {
    options.value.splice(idx, 1);
    return;
  }
  // Refs present → open the confirm dialog. The dialog calls apply via
  // useCascadeApply; on confirm we splice the option locally + show Undo.
  cascadeDialogProps.value = {
    kind: "option",
    id: opt.id,
    action: "delete",
    extra: { wildcard_id: props.id, _row_idx: idx },
  };
  cascadeDialogOpen.value = true;
}

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<WildcardPayload>;
  options.value = (p.options ?? []).map((o) => ({ ...o }));
  subCategories.value = [...(p.sub_categories ?? [])];
  varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(entry.name);
  toast.push({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  // Update varBindingError synchronously so the rollup picks it up
  // in the same tick. The validation computed reads this ref.
  const finalBinding = varBinding.value.trim() || toIdentifier(name.value);
  if (varBinding.value.trim() && !VALID_IDENTIFIER_RE.test(finalBinding)) {
    varBindingError.value = "Use letters, digits, underscores; must not start with a digit.";
  } else {
    varBindingError.value = "";
  }
  if (validationErrors.value.length > 0) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;
  setSaveState("saving");
  saving.value = true;
  try {
    // Re-hoist any null option to index 0 before persisting. Drag-sort
    // is allowed to land it anywhere during editing; the serialised
    // payload always pins the null option first.
    const sortedOptions = hoistNullFirst(options.value);
    if (sortedOptions !== options.value) options.value = sortedOptions;
    const payload: WildcardPayload = {
      options: sortedOptions,
      sub_categories: subCategories.value,
      var_binding: finalBinding,
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
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: { ...newPayload, history: nextHistory },
        content_rating: contentRating.value,
      });
      historyEntries.value = nextHistory;
      recent.push({ id: props.id, kind: "wildcard", name: name.value });
    } else {
      // New mode: moduleStore.create() does not expose the new id on the
      // returned row in a way that's stable across mock/real backends.
      // The next time the user opens this item the mount-time push fires.
      await moduleStore.create({
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: newPayload,
        content_rating: contentRating.value,
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
    router.push(resolveReturnTo("/wildcards"));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/wildcards")); }

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/wildcards", label: "Wildcards" },
  { label: isEdit.value ? (name.value || "Editing") : "New wildcard" },
]);

/** Set true on the first Save click while invalid; cleared on a
 *  valid save. Gates rollup visibility so the banner is feedback,
 *  not a nagging pre-emptive scolding while the user is still
 *  filling the form. */
const showErrors = ref(false);

const validationErrors = computed<EditorFieldError[]>(() => {
  const out: EditorFieldError[] = [];
  if (!name.value.trim()) {
    out.push({ field: "editor-section-identity", label: "Name", message: "Required" });
  } else {
    // Wildcard names become the `#name` segment of nested refs.
    // Forbidding the grammar-reserved chars here mirrors
    // `wp_api/_validators.py:REF_GRAMMAR_FORBIDDEN_CHARS` so the
    // server never has to reject a save the editor already accepted.
    const REF_FORBIDDEN = /[{}:#@,]/;
    const bad = name.value.match(REF_FORBIDDEN);
    if (bad) {
      out.push({
        field: "editor-section-identity",
        label: "Name",
        message: `Cannot contain "${bad[0]}" (reserved by the @{uuid#name:subcat} ref grammar)`,
      });
    }
  }
  if (varBindingError.value) {
    out.push({ field: "editor-section-identity", label: "$variable binding", message: varBindingError.value });
  }
  if (options.value.length === 0) {
    out.push({ field: "editor-section-options", label: "Options", message: "At least one option is required" });
  } else {
    for (let i = 0; i < options.value.length; i++) {
      const o = options.value[i];
      // Null option's `value` is intentionally empty — skip the
      // non-empty-string check for it. See spec
      // `docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md`.
      if (o.is_null) continue;
      if (!o.value || !o.value.trim()) {
        out.push({ field: "editor-section-options", label: `Option #${i + 1}`, message: "Value cannot be empty" });
        break;
      }
    }
  }
  return out;
});

const visibleErrors = computed<EditorFieldError[]>(() =>
  showErrors.value ? validationErrors.value : [],
);

defineExpose({ historyEntries, applyRestore, options });
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit wildcard' : 'New wildcard'"
    back-route="/wildcards"
    back-label="Wildcards"
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
    <template v-if="isEdit && currentRow" #header-extra>
      <CommunityRowActions :row="currentRow" kind="module" labeled />
    </template>
    <template v-if="isEdit" #footer-left>
      <Button
        variant="ghost"
        icon="pi-trash"
        class="wp-btn--danger"
        data-test="wc-delete-btn"
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
        :var-binding="varBinding"
        :var-binding-error="varBindingError"
        @update:name="(v) => (name = v)"
        @update:description="(v) => (description = v)"
        @update:category-id="(v) => (categoryId = v)"
        :content-rating="contentRating"
        @update:tags="(v) => (tags = v)"
        @update:content-rating="(v) => (contentRating = v)"
        @update:var-binding="(v) => (varBinding = v)"
      />
    </div>

    <div id="editor-section-sub-categories">
      <Card title="Sub-Categories">
        <template #actions>
          <span class="wp-card__hint">Optional groupings inside this wildcard</span>
        </template>
        <div class="sub-add-row">
          <Input
            v-model="subDraft"
            placeholder="e.g. warm tones"
            data-test="wc-sub-input"
            @keydown.enter.prevent="addSub"
          />
          <Button icon="pi-plus" data-test="wc-sub-add" @click="addSub">Add</Button>
        </div>
        <div v-if="subCategories.length" class="sub-list">
          <span v-for="s in subCategories" :key="s" class="wp-subcat-chip-row">
            <Chip
              tone="accent"
              removable
              @remove="onSubcatDeleteClick(s)"
            >{{ s }}<PillCountBadge :count="props.id ? cascade.subcatRefsTo(props.id, s).length : 0" /></Chip>
            <Button
              v-if="props.id"
              variant="ghost"
              size="sm"
              icon="pi-pencil"
              :aria-label="`Rename sub-category ${s}`"
              :data-test="`wc-sub-rename-${s}`"
              class="wp-subcat-rename-btn"
              @click="onSubcatRenameClick(s)"
            />
          </span>
        </div>
        <span v-else class="wp-card__hint">No sub-categories yet.</span>
      </Card>
    </div>

    <div id="editor-section-options">
    <Card :title="`Options (${options.length})`" :padding="false">
      <template #actions>
        <Button
          size="sm"
          variant="ghost"
          icon="pi-ban"
          :disabled="hasNullOption"
          data-test="wc-add-null"
          @click="addNullOption"
        >Add null</Button>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="wc-add-opt" @click="addOption">
          Add option
        </Button>
      </template>
      <table class="wp-table wp-options-table">
        <thead>
          <tr>
            <th scope="col" class="opt-col-weight">Weight</th>
            <th scope="col">Value</th>
            <th scope="col" class="opt-col-sub">Sub-category</th>
            <th scope="col" class="opt-col-prob">Probability</th>
            <th scope="col" class="opt-col-trash"><span class="wp-sr-only">Remove option</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(o, i) in options"
            :key="o.id"
            :data-test="o.is_null ? 'wc-opt-row-null' : `wc-opt-row-${i}`"
            :class="{ 'wc-opt-row--null': o.is_null }"
          >
            <td>
              <Input
                :model-value="o.weight"
                type="number"
                size="sm"
                min="0.01"
                step="0.1"
                aria-label="Option weight"
                @update:model-value="(v) => {
                  // Clamp to >0 — weight 0 or negative never picks
                  // (probability normalises away). Editor floors at
                  // 0.01 so a typo can't silently disable an option.
                  // To disable an option, use the per-instance toggle
                  // in the Context node (engine respects that).
                  const n = Number(v);
                  o.weight = Number.isFinite(n) && n > 0 ? n : 0.01;
                }"
              />
            </td>
            <td>
              <span v-if="o.is_null" class="wc-null-chip" aria-label="null option (resolves to empty)">
                <i class="pi pi-ban" aria-hidden="true" />
                <span>null</span>
              </span>
              <RichTextInput
                v-else
                v-model="o.value"
                surface="wildcard"
                :ref-suggestions="wcSuggestions"
                :uuid-to-name="nameByUuid"
                :uuid-to-sub-categories="uuidToSubCategories"
                :uuid-to-has-null="uuidToHasNull"
                :uuid-to-options-count="uuidToOptionsCount"
                placeholder="value (type @ for nested wildcards · {a|b|c} for inline choices)"
                aria-label="Option value"
              />
            </td>
            <td>
              <span v-if="o.is_null" class="wc-em-dash" aria-hidden="true">—</span>
              <Select
                v-else
                :model-value="o.sub_category ?? ''"
                :options="subCategoryOptions"
                placeholder="(none)"
                clearable
                aria-label="Sub-category for option"
                data-test="wc-opt-subcat"
                @update:model-value="(v) => (o.sub_category = (v as string) || null)"
              />
            </td>
            <td>
              <div class="opt-prob">
                <div class="opt-prob__bar">
                  <div class="opt-prob__fill" :style="{ width: probabilityFor(o) + '%' }" />
                </div>
                <span class="opt-prob__value wp-mono">{{ probabilityFor(o).toFixed(0) }}%</span>
              </div>
            </td>
            <td>
              <Button
                size="sm"
                variant="ghost"
                icon="pi-trash"
                class="wp-btn--danger"
                aria-label="Remove option"
                @click="removeOption(i)"
              />
            </td>
          </tr>
          <tr v-if="!options.length">
            <td colspan="5" class="opt-empty">No options yet.</td>
          </tr>
        </tbody>
      </table>
    </Card>
    </div>

    <!-- CascadeConfirmDialog: shown when a sub-category pill X-click has
         downstream refs (refs > 0). Teleports to body internally. -->
    <CascadeConfirmDialog
      v-if="cascadeDialogProps"
      :open="cascadeDialogOpen"
      v-bind="cascadeDialogProps"
      @confirmed="onCascadeDialogConfirmed"
      @cancelled="onCascadeDialogCancelled"
    />

    <!-- CascadeRenameDialog: opened by the pencil button on a sub-category
         chip. Cascades the rename to any modules referencing this subcat. -->
    <CascadeRenameDialog
      v-if="props.id && subcatRenameTarget"
      :open="subcatRenameOpen"
      kind="subcategory"
      :id="props.id"
      :extra="{ subcat_name: subcatRenameTarget }"
      :initial-name="subcatRenameTarget"
      @confirmed="onSubcatRenameConfirmed"
      @cancelled="onSubcatRenameCancelled"
    />

    <!-- ConfirmDialog lives INSIDE EditorFrame so the template has a single
         root vnode. Multi-root templates break the parent RouterView's
         <Transition mode="out-in"> after this component unmounts — the
         transition tracker desyncs and the destination view never paints.
         Dialog still Teleports to body via its internal <Teleport>; the
         source placement here only affects vnode tracking. -->
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
.sub-add-row {
  display: flex;
  gap: var(--wp-space-4);
  margin-bottom: var(--wp-space-5);
}
.sub-add-row > :first-child { flex: 1; }
.sub-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
}
.wp-subcat-chip-row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
/* Pencil rename button uses the shared <Button variant="ghost" size="sm">.
 * Override sits at 0,0,1,1 to bump the at-rest opacity down so the
 * affordance reads as secondary next to the primary remove chip. */
.wp-subcat-chip-row .wp-subcat-rename-btn {
  opacity: 0.65;
}
.wp-subcat-chip-row .wp-subcat-rename-btn:hover,
.wp-subcat-chip-row .wp-subcat-rename-btn:focus-visible {
  opacity: 1;
}
.wp-options-table {
  font-size: var(--wp-text-sm);
}
.opt-col-weight { width: 90px; }
.opt-col-sub { width: 200px; }
.opt-col-prob { width: 130px; }
.opt-col-trash { width: 40px; }
.opt-empty {
  text-align: center;
  padding: var(--wp-space-6);
  color: var(--wp-text-dim);
}
.opt-prob {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.opt-prob__bar {
  flex: 1;
  height: 6px;
  background: var(--wp-bg-3);
  border-radius: 999px;
  overflow: hidden;
}
.opt-prob__fill {
  height: 100%;
  background: var(--wp-accent-gradient);
}
.opt-prob__value {
  width: 32px;
  text-align: right;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}

/* Null option chip — used for the value-column placeholder on a row
 * whose option carries is_null=true. Visually distinct from the
 * RichTextInput pills used by normal option values so users see at a
 * glance that this row will resolve to nothing. */
.wc-null-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--wp-text-muted) 12%, transparent);
  border: 1px dashed var(--wp-border);
  border-radius: 4px;
  color: var(--wp-text-muted);
  font-family: var(--wp-font-mono, monospace);
  font-size: var(--wp-text-sm);
}
.wc-null-chip .pi { font-size: 12px; }
.wc-em-dash {
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono, monospace);
  opacity: 0.55;
  padding: 0 var(--wp-space-4);
}
.wc-opt-row--null {
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
}
</style>
