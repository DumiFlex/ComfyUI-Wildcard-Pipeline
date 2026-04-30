<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import type { ModuleEntry } from "../../widgets/_shared";
import {
  ensure as ensurePreviewLookup,
  lookup as previewLookup,
  cacheVersion as previewCacheVersion,
} from "../../extension/preview-resolver";

const WC_REF_RE = /@\{([0-9a-f]{8})\}/g;

const props = defineProps<{
  visible: boolean;
  module: ModuleEntry | null;
  /** Variable names defined upstream — used for autocomplete + validity checks. */
  upstreamVars?: string[];
  /** Variable names defined by OTHER modules in the same node. */
  siblingVars?: string[];
  /** Other modules in the same WP_Context node — used by the constraint
   *  preview to resolve source/target uuids back to var-binding names.
   *  May include the module being edited; lookups by uuid skip self. */
  siblingModules?: ModuleEntry[];
  /**
   * Pull the seed THIS module actually rolled with on the last
   * queue. Returns `locked_seed` for wildcards locked at run time;
   * the chain seed otherwise. Snapshotted by the seed widget's
   * `beforeQueued` hook (see widgets/context.ts). Lock toggle uses
   * it so re-locking restores the seed THIS wildcard used, not the
   * generic chain seed.
   */
  lastUsedSeedReader?: (moduleId?: string) => number | null;
}>();

const emit = defineEmits<{
  (e: "save", value: ModuleEntry): void;
  (e: "close"): void;
}>();

// Draft state — owned by the modal. Cancel discards, Save commits via emit.
// `module` prop is the source-of-truth snapshot at open time; we deep-clone
// via JSON round-trip (Proxy-safe at every depth, unlike structuredClone).
const draft = ref<ModuleEntry | null>(null);
const firstNameInput = ref<HTMLInputElement | null>(null);
const moduleNameInput = ref<HTMLInputElement | null>(null);

watch(() => props.visible, async (v) => {
  if (v && props.module) {
    draft.value = JSON.parse(JSON.stringify(props.module));
    await nextTick();
    // Wildcard options often reference nested wildcards via `@{uuid}`.
    // Kick a background fetch so the option-list renders friendly
    // `@name` once names land; falls back to `@{uuid}` until then.
    // Deferred until after nextTick to avoid the immediate-watch TDZ
    // (preloadOptionRefs reads `wildcardOptions`, defined later in
    // setup; the immediate-fire branch ran before that init point).
    preloadOptionRefs();
    // Snapshot kinds (non-fixed_values) don't render either input, so
    // skip auto-focus there. Only fixed_values has entries / a name
    // input to focus.
    if (draft.value && draft.value.type === "fixed_values") {
      if (draft.value.entries.length > 0) {
        firstNameInput.value?.focus();
        firstNameInput.value?.select();
      } else {
        moduleNameInput.value?.focus();
        moduleNameInput.value?.select();
      }
    }
    window.addEventListener("keydown", onKeydown);
  } else {
    window.removeEventListener("keydown", onKeydown);
    draft.value = null;
  }
}, { immediate: true });

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function onKeydown(ev: KeyboardEvent) {
  if (!props.visible) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
    ev.preventDefault();
    save();
  }
}

function iconFor(type: ModuleEntry["type"]): string {
  if (type === "fixed_values") return "pi-tag";
  if (type === "wildcard") return "pi-th-large";
  if (type === "combine") return "pi-share-alt";
  if (type === "derivation") return "pi-code";
  if (type === "constraint") return "pi-sitemap";
  if (type === "pipeline") return "pi-list";
  return "pi-question";
}

/**
 * Wildcard option-list editor — exposes per-option enable/disable +
 * per-option weight override. Saves to `draft.instance.enabled_options`
 * + `draft.instance.option_weights` which the engine handler honors at
 * run time. Reads option ids from `payload.options[].id`; if any
 * option is missing an id the row binds by index (best-effort, weight
 * override won't persist for that row but enable/disable still works
 * via list filtering).
 */
interface WildcardOption {
  id?: string;
  value?: string;
  weight?: number;
  sub_category?: string | null;
}

const wildcardOptions = computed<WildcardOption[]>(() => {
  if (!draft.value || draft.value.type !== "wildcard") return [];
  const opts = (draft.value.payload as { options?: WildcardOption[] } | undefined)?.options;
  return Array.isArray(opts) ? opts : [];
});

/**
 * List of sub-categories declared in the wildcard payload, deduped +
 * sorted. Falls back to a derived list if the payload doesn't carry
 * `sub_categories` explicitly (some legacy rows only set option-level
 * sub_category fields).
 */
const wildcardSubCategories = computed<string[]>(() => {
  if (!draft.value || draft.value.type !== "wildcard") return [];
  const declared = (draft.value.payload as { sub_categories?: string[] } | undefined)?.sub_categories;
  if (Array.isArray(declared) && declared.length > 0) {
    return [...new Set(declared)].sort((a, b) => a.localeCompare(b));
  }
  // Derive from option metadata when not declared explicitly.
  const seen = new Set<string>();
  for (const o of wildcardOptions.value) {
    if (typeof o.sub_category === "string" && o.sub_category) seen.add(o.sub_category);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
});

function isCategoryActive(cat: string): boolean {
  const filter = draft.value?.instance?.category_filter;
  // Missing / null / empty = no filter (every category active).
  if (!Array.isArray(filter) || filter.length === 0) return true;
  return filter.includes(cat);
}

function toggleCategory(cat: string) {
  if (!draft.value) return;
  const inst = draft.value.instance ?? {};
  const allCats = wildcardSubCategories.value;
  const current = Array.isArray(inst.category_filter) && inst.category_filter.length > 0
    ? [...inst.category_filter]
    : [...allCats];
  const idx = current.indexOf(cat);
  if (idx >= 0) current.splice(idx, 1);
  else current.push(cat);
  // Drop the override when it matches "all enabled" so the persisted
  // shape stays minimal.
  const allEnabled = current.length === allCats.length && allCats.every((c) => current.includes(c));
  draft.value.instance = {
    ...inst,
    category_filter: allEnabled ? null : current,
  };
}

/** True if a given option survives the current category_filter. Options
 *  without a sub_category survive only when the filter is null/empty. */
function passesCategoryFilter(opt: WildcardOption): boolean {
  const filter = draft.value?.instance?.category_filter;
  if (!Array.isArray(filter) || filter.length === 0) return true;
  return typeof opt.sub_category === "string" && filter.includes(opt.sub_category);
}

/** Options visible in the per-option list — narrowed by category_filter
 *  in subcategory-aware Subset mode so the user sees only what's
 *  eligible. In Random / Pinned modes we always show all options. */
const visibleWildcardOptions = computed<WildcardOption[]>(() => {
  if (currentMode.value !== "subcategory") return wildcardOptions.value;
  if (wildcardSubCategories.value.length === 0) return wildcardOptions.value;
  return wildcardOptions.value.filter(passesCategoryFilter);
});

/** Map every `@{uuid}` ref in a wildcard option's value to a friendlier
 *  `@<library-name>` form, falling back to the raw `@{uuid}` placeholder
 *  when the preview-resolver hasn't yet cached the target. Reads
 *  {@link previewCacheVersion} so Vue re-renders when a fetch lands. */
function displayValue(opt: WildcardOption): string {
  // Touch the reactive trigger — Vue tracks this dep when the function
  // is called inside template render / computed evaluation. Without it
  // the rendered string would freeze at the first cache snapshot.
  void previewCacheVersion.value;
  const raw = String(opt.value ?? "");
  if (!raw.includes("@{")) return raw;
  return raw.replace(WC_REF_RE, (full, uuid: string) => {
    const lk = previewLookup(uuid);
    return lk?.name ? `@${lk.name}` : full;
  });
}

/** Pre-fetch every nested `@{uuid}` ref appearing in this wildcard's
 *  options so the modal's option list can render `@name` instead of
 *  the raw uuid placeholder. Idempotent — `ensure` skips already-
 *  cached / inflight / failed uuids. */
function preloadOptionRefs() {
  if (!draft.value || draft.value.type !== "wildcard") return;
  const uuids = new Set<string>();
  for (const o of wildcardOptions.value) {
    const v = String(o.value ?? "");
    for (const m of v.matchAll(WC_REF_RE)) uuids.add(m[1]);
  }
  if (uuids.size) ensurePreviewLookup(uuids);
}

function isOptionEnabled(opt: WildcardOption): boolean {
  // No instance override = all enabled (engine default).
  const enabled = draft.value?.instance?.enabled_options;
  if (!Array.isArray(enabled)) return true;
  if (!opt.id) return true; // no id → can't filter; default to enabled
  return enabled.includes(opt.id);
}

function setOptionEnabled(opt: WildcardOption, on: boolean) {
  if (!draft.value || !opt.id) return;
  const inst = draft.value.instance ?? {};
  const allIds = wildcardOptions.value.map((o) => o.id).filter((id): id is string => !!id);
  const current = Array.isArray(inst.enabled_options) ? [...inst.enabled_options] : [...allIds];
  if (on) {
    if (!current.includes(opt.id)) current.push(opt.id);
  } else {
    const idx = current.indexOf(opt.id);
    if (idx >= 0) current.splice(idx, 1);
  }
  // Drop the override if it now matches "all enabled" — keeps payload
  // clean + matches the engine's "missing == all enabled" default.
  const allEnabled = current.length === allIds.length && allIds.every((id) => current.includes(id));
  draft.value.instance = {
    ...inst,
    enabled_options: allEnabled ? null : current,
  };
}

function effectiveWeight(opt: WildcardOption): number {
  const overrides = draft.value?.instance?.option_weights;
  if (overrides && opt.id && typeof overrides[opt.id] === "number") {
    return overrides[opt.id];
  }
  return typeof opt.weight === "number" ? opt.weight : 1;
}

function setOptionWeight(opt: WildcardOption, raw: string) {
  if (!draft.value || !opt.id) return;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return;
  const inst = draft.value.instance ?? {};
  const overrides: Record<string, number> = { ...(inst.option_weights ?? {}) };
  // Drop the override when it matches the library weight to keep the
  // value object minimal — same logic as enabled_options above.
  const libraryWeight = typeof opt.weight === "number" ? opt.weight : 1;
  if (num === libraryWeight) {
    delete overrides[opt.id];
  } else {
    overrides[opt.id] = num;
  }
  draft.value.instance = {
    ...inst,
    option_weights: Object.keys(overrides).length === 0 ? null : overrides,
  };
}

const allOptionsEnabled = computed<boolean>(() => {
  return wildcardOptions.value.every((o) => isOptionEnabled(o));
});

function bulkSetEnabled(on: boolean) {
  if (!draft.value) return;
  const inst = draft.value.instance ?? {};
  if (on) {
    draft.value.instance = { ...inst, enabled_options: null };
  } else {
    draft.value.instance = { ...inst, enabled_options: [] };
  }
}

function resetOverrides() {
  if (!draft.value) return;
  draft.value.instance = {};
}

const hasInstanceOverrides = computed<boolean>(() => {
  // Lock + internal track their own state via dedicated UI; only
  // option-pool overrides count for the "has overrides → reset"
  // affordance + the card's modified dot. Symmetric with
  // ContextWidget.isModified.
  const inst = draft.value?.instance;
  if (!inst) return false;
  if (Array.isArray(inst.enabled_options)) return true;
  if (inst.option_weights && Object.keys(inst.option_weights).length > 0) return true;
  if (inst.mode && inst.mode !== "random") return true;
  if (inst.pinned_option_id) return true;
  if (Array.isArray(inst.category_filter) && inst.category_filter.length > 0) return true;
  return false;
});

// Lock — when active, derives a stable per-instance RNG seed from
// `(locked_seed, var_binding)`. The seed PERSISTS across toggles via
// `last_locked_seed` so toggling off → on doesn't lose the user's
// last value. First-ever toggle defaults to 0 (predictable, not
// random); the reroll button generates a fresh random seed when
// the user explicitly wants one.
const lockEnabled = computed<boolean>(() =>
  typeof draft.value?.instance?.locked_seed === "number",
);
function toggleLock() {
  if (!draft.value) return;
  const inst = draft.value.instance ?? {};
  if (lockEnabled.value) {
    // Off — keep last_locked_seed for the next toggle-on.
    draft.value.instance = { ...inst, locked_seed: null };
  } else {
    // On — per-module fallback chain:
    //   1. lastUsedSeedReader(draft.id) — seed THIS module rolled
    //      with on last queue (its locked_seed if locked, else
    //      chain seed). Refreshes per queue.
    //   2. last_locked_seed — cold-start fallback (no queue yet).
    //   3. 0 (final default).
    let fallback: number;
    const lastUsed = props.lastUsedSeedReader?.(draft.value.id);
    if (typeof lastUsed === "number") {
      fallback = lastUsed;
    } else if (typeof inst.last_locked_seed === "number") {
      fallback = inst.last_locked_seed;
    } else {
      fallback = 0;
    }
    draft.value.instance = {
      ...inst,
      locked_seed: fallback,
      last_locked_seed: fallback,
    };
  }
}
function setLockedSeed(raw: string) {
  if (!draft.value) return;
  const num = Number(raw);
  if (!Number.isFinite(num)) return;
  const next = Math.floor(num);
  draft.value.instance = {
    ...(draft.value.instance ?? {}),
    locked_seed: next,
    last_locked_seed: next,
  };
}
function rerollLockedSeed() {
  if (!draft.value || !lockEnabled.value) return;
  const next = Math.floor(Math.random() * 0xffffffff);
  draft.value.instance = {
    ...(draft.value.instance ?? {}),
    locked_seed: next,
    last_locked_seed: next,
  };
}

// Internal — toggle hides this module's bindings from the public
// socket payload. Downstream modules in the chain still see them.
const internalEnabled = computed<boolean>(() => !!draft.value?.instance?.internal);
function toggleInternal() {
  if (!draft.value) return;
  const inst = draft.value.instance ?? {};
  // Drop the field entirely when going back to default-false so the
  // persisted JSON stays minimal.
  if (internalEnabled.value) {
    const { internal: _drop, ...rest } = inst;
    void _drop;
    draft.value.instance = rest;
  } else {
    draft.value.instance = { ...inst, internal: true };
  }
}

// Pick mode — UX state. Engine treats `null` and `random` identically;
// `subcategory` surfaces the `enabled_options` checkboxes so the user
// has explicit "manual subset" framing; `pinned` swaps to a radio-list
// and locks RNG to the chosen option.
type PickMode = "random" | "subcategory" | "pinned";
const PICK_MODES: { id: PickMode; label: string; hint: string }[] = [
  { id: "random",      label: "Random",       hint: "weighted RNG over every option" },
  { id: "subcategory", label: "Subset",       hint: "weighted RNG over options you tick on" },
  { id: "pinned",      label: "Pinned",       hint: "always pick the same option (no RNG)" },
];

const currentMode = computed<PickMode>(() => {
  const m = draft.value?.instance?.mode;
  return m === "subcategory" || m === "pinned" ? m : "random";
});

function setMode(next: PickMode) {
  if (!draft.value) return;
  const inst = draft.value.instance ?? {};
  // Drop overrides that no longer apply when leaving a mode:
  //   - leaving `subcategory` → clear enabled_options (random covers all)
  //   - leaving `pinned`      → clear pinned_option_id
  //   - entering `pinned`     → default pinned_option_id to the first
  //     option with an id (so the picker shows a sensible initial choice)
  const updated = { ...inst };
  if (currentMode.value === "subcategory" && next !== "subcategory") {
    updated.enabled_options = null;
    updated.category_filter = null;
  }
  if (currentMode.value === "pinned" && next !== "pinned") {
    updated.pinned_option_id = null;
  }
  if (next === "pinned" && !updated.pinned_option_id) {
    const first = wildcardOptions.value.find((o) => !!o.id);
    updated.pinned_option_id = first?.id ?? null;
  }
  // Persist `null` for the random default to keep the JSON minimal.
  updated.mode = next === "random" ? null : next;
  draft.value.instance = updated;
}

function setPinnedId(id: string) {
  if (!draft.value) return;
  draft.value.instance = { ...(draft.value.instance ?? {}), pinned_option_id: id };
}

function isOptionPinned(opt: WildcardOption): boolean {
  return !!opt.id && draft.value?.instance?.pinned_option_id === opt.id;
}

/** Whether a given option's effective weight differs from the library
 *  default. Drives the inline override-indicator dot on the weight cell. */
function isWeightOverridden(opt: WildcardOption): boolean {
  const overrides = draft.value?.instance?.option_weights;
  if (!overrides || !opt.id) return false;
  return typeof overrides[opt.id] === "number";
}

// Per-entry validity:
//   ok       — name is set and unique
//   empty    — name not set yet (no glyph)
//   shadow   — name exists upstream OR in another module in this node
//              (informational; runtime is last-write-wins anyway)
//   dup      — same name appears earlier in THIS module (real bug — the
//              second write inside the same module is silently ignored)
type EntryStatus = "ok" | "empty" | "shadow" | "dup";

const entryStatuses = computed<EntryStatus[]>(() => {
  if (!draft.value) return [];
  const known = new Set([...(props.upstreamVars ?? []), ...(props.siblingVars ?? [])]);
  const seen = new Set<string>();
  return draft.value.entries.map((e) => {
    const name = e.variable_name.trim();
    if (!name) return "empty";
    if (seen.has(name)) return "dup";
    seen.add(name);
    if (known.has(name)) return "shadow";
    return "ok";
  });
});

function statusTooltip(s: EntryStatus): string {
  if (s === "ok") return "Unique name";
  if (s === "shadow") return "Already defined upstream or in another module here";
  if (s === "dup") return "Duplicate name in this module";
  return "";
}

function addEntry() {
  if (!draft.value) return;
  draft.value.entries.push({ variable_name: "", value: "" });
}

function removeEntry(idx: number) {
  if (!draft.value) return;
  draft.value.entries.splice(idx, 1);
}

function updateVarName(idx: number, v: string) {
  if (!draft.value) return;
  draft.value.entries[idx].variable_name = v.replace(/^\$+/, "");
}

function onValueEnter(idx: number, ev: KeyboardEvent) {
  if (!draft.value) return;
  ev.preventDefault();
  const isLast = idx === draft.value.entries.length - 1;
  if (isLast) {
    addEntry();
    nextTick(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(".wp-medit__entry-var");
      inputs[inputs.length - 1]?.focus();
    });
  } else {
    nextTick(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(".wp-medit__entry-var");
      inputs[idx + 1]?.focus();
    });
  }
}

// Bulk paste — multi-line `name=value` text becomes N entries auto-parsed.
// Triggered when the user pastes into a variable-name input. If the paste
// is single-line, defer to native input behavior.
function onNamePaste(idx: number, ev: ClipboardEvent) {
  if (!draft.value) return;
  const text = ev.clipboardData?.getData("text") ?? "";
  if (!text.includes("\n") && !text.includes("=")) return; // single token — let browser paste
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return;
  // Each line: name=value, name : value, or just name
  const parsed = lines.map((line) => {
    const m = /^\s*\$?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (m) return { variable_name: m[1], value: m[2] };
    const nameOnly = /^\s*\$?([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(line);
    if (nameOnly) return { variable_name: nameOnly[1], value: "" };
    return null;
  }).filter((x): x is { variable_name: string; value: string } => x !== null);
  if (parsed.length === 0) return;
  ev.preventDefault();
  // Replace the current row with first parsed entry, splice the rest after.
  draft.value.entries[idx] = parsed[0];
  if (parsed.length > 1) {
    draft.value.entries.splice(idx + 1, 0, ...parsed.slice(1));
  }
}

function save() {
  if (!draft.value) return;
  const next = JSON.parse(JSON.stringify(draft.value)) as ModuleEntry;
  // fixed_values: the engine resolves from `payload.values`, not the
  // widget-side `entries` array. Mirror the user-edited entries into
  // payload before emitting so runtime sees the latest names + values.
  // Keeps both inline-created (no payload at pick time) and
  // library-picked (payload pre-populated) flows in sync.
  if (next.type === "fixed_values") {
    const values = next.entries.map((e, i) => ({
      id: `val_${i.toString(16).padStart(4, "0")}`,
      name: e.variable_name,
      value: e.value,
    }));
    next.payload = { ...(next.payload ?? {}), values };
  }
  emit("save", next);
}

function cancel() {
  emit("close");
}

// HTML <datalist> id needs to be unique per modal mount so multiple Context
// nodes don't share a list (though only one modal is visible at a time).
const datalistId = `wp-medit-vars-${Math.random().toString(36).slice(2, 8)}`;

// Autocomplete options = upstream + sibling modules' variables, deduped.
const autocompleteOptions = computed<string[]>(() => {
  const set = new Set([...(props.upstreamVars ?? []), ...(props.siblingVars ?? [])]);
  return [...set].sort();
});

// SPA editor deep-link path per kind. The Manager SPA is mounted at
// `/wp/` with `createWebHistory("/wp/")` — HTML5 history mode, NOT
// hash-based. The previous `/wp/manager/#/...` shape was wrong on two
// counts: there's no `manager/` segment in the mount path, and the
// trailing `#/...` hash is ignored by web-history. The browser would
// land on `/wp/manager/`, miss the route, hit the catch-all redirect
// to `/wp/wildcards`, dropping users on the LIST view instead of the
// per-row editor.
//
// Correct shape: `${origin}/wp/${segment}/${id}/edit` — matches the
// router children paths registered in `manager/router/index.ts`.
const SPA_KIND_ROUTE: Record<string, string> = {
  wildcard:     "wildcards",
  fixed_values: "fixed-values",
  combine:      "combines",
  derivation:   "derivations",
  constraint:   "constraints",
  pipeline:     "pipelines",
};

const spaEditorHref = computed<string>(() => {
  const m = draft.value;
  if (!m) return "#";
  const segment = SPA_KIND_ROUTE[m.type];
  if (!segment) return "#";
  return `${window.location.origin}/wp/${segment}/${m.id}/edit`;
});

// Resolve a sibling module's uuid back to its bound variable name (or
// fall back to the meta name when no var_binding is set). Returns null
// if the uuid doesn't match any sibling.
function lookupSiblingName(uuid: string | null | undefined): string | null {
  if (!uuid) return null;
  const sib = (props.siblingModules ?? []).find((s) => s.id === uuid);
  if (!sib) return null;
  const binding = (sib.payload as { var_binding?: string } | undefined)?.var_binding;
  if (typeof binding === "string" && binding.trim()) return binding.trim();
  const name = sib.meta?.name?.trim();
  return name ? name : null;
}

// ── Combine preview ──────────────────────────────────────────────────
const combineTemplate = computed<string>(() => {
  if (!draft.value || draft.value.type !== "combine") return "";
  const p = draft.value.payload as { template?: string } | undefined;
  return (p?.template ?? "").toString();
});
const combineOutputVar = computed<string>(() => {
  if (!draft.value || draft.value.type !== "combine") return "";
  const p = draft.value.payload as { output_var?: string } | undefined;
  return (p?.output_var ?? "").toString().replace(/^\$/, "");
});

// ── Derivation preview ───────────────────────────────────────────────
interface DerivBranchView {
  condition: { var: string; op: string; value: string };
  action: { target_var: string; mode: string; value: string };
}
interface DerivRuleView {
  id?: string;
  branches: DerivBranchView[];
  else?: { action: { target_var: string; mode: string; value: string } };
}
const derivationRules = computed<DerivRuleView[]>(() => {
  if (!draft.value || draft.value.type !== "derivation") return [];
  const p = draft.value.payload as { rules?: DerivRuleView[] } | undefined;
  return Array.isArray(p?.rules) ? p.rules : [];
});

function formatOp(op: string): string {
  if (op === "equals") return "==";
  if (op === "not_equals") return "!=";
  if (op === "contains") return "contains";
  if (op === "matches") return "~";
  return op;
}
function formatMode(mode: string): string {
  if (mode === "replace") return "=";
  if (mode === "append")  return "+= ,";
  if (mode === "prepend") return "prepend";
  return mode;
}

// ── Constraint preview ───────────────────────────────────────────────
interface ConstraintExceptionView { source: string; target: string; mode: string; factor: number }
const constraintSourceLabel = computed<string>(() => {
  if (!draft.value || draft.value.type !== "constraint") return "?";
  const p = draft.value.payload as { source_wildcard_id?: string | null } | undefined;
  if (!p?.source_wildcard_id) return "(unset)";
  return lookupSiblingName(p.source_wildcard_id) ?? p.source_wildcard_id;
});
const constraintTargetLabel = computed<string>(() => {
  if (!draft.value || draft.value.type !== "constraint") return "?";
  const p = draft.value.payload as { target_wildcard_id?: string | null } | undefined;
  if (!p?.target_wildcard_id) return "(unset)";
  return lookupSiblingName(p.target_wildcard_id) ?? p.target_wildcard_id;
});
const constraintRowCount = computed<number>(() => {
  if (!draft.value || draft.value.type !== "constraint") return 0;
  const p = draft.value.payload as { matrix?: Record<string, Record<string, unknown>> } | undefined;
  return Object.keys(p?.matrix ?? {}).length;
});
const constraintColCount = computed<number>(() => {
  if (!draft.value || draft.value.type !== "constraint") return 0;
  const p = draft.value.payload as { matrix?: Record<string, Record<string, unknown>> } | undefined;
  const firstRow = Object.values(p?.matrix ?? {})[0];
  return Object.keys(firstRow ?? {}).length;
});
const constraintExceptions = computed<ConstraintExceptionView[]>(() => {
  if (!draft.value || draft.value.type !== "constraint") return [];
  const p = draft.value.payload as { exceptions?: ConstraintExceptionView[] } | undefined;
  return Array.isArray(p?.exceptions) ? p.exceptions : [];
});
</script>

<template>
  <ModalShell :visible="visible" @close="cancel">
    <div v-if="draft" class="wp-medit">
      <header class="wp-medit__head">
        <i :class="['pi', iconFor(draft.type), 'wp-medit__head-icon', `type-${draft.type}`]" aria-hidden="true"></i>
        <!-- fixed_values: editable name. Snapshots (every other kind):
             read-only — name belongs to the library row, not the
             per-instance override surface. -->
        <input
          v-if="draft.type === 'fixed_values'"
          ref="moduleNameInput"
          v-model="draft.meta.name"
          class="wp-medit__name-input"
          placeholder="module name"
          spellcheck="false"
        />
        <span v-else class="wp-medit__name-readonly">
          {{ draft.meta.name || draft.type }}
          <span class="wp-medit__name-kind">· {{ draft.type }}</span>
        </span>
        <button type="button" class="wp-medit__close" aria-label="Close" @click="cancel">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </header>

      <div class="wp-medit__body">
        <!-- DESCRIPTION shown only for fixed_values. Library-snapshot
             kinds delegate description ownership to the library row. -->
        <section v-if="draft.type === 'fixed_values'" class="wp-medit__section">
          <label class="wp-medit__section-label">DESCRIPTION</label>
          <input
            v-model="draft.meta.description"
            class="wp-medit__meta-input"
            placeholder="optional — what this module is for"
          />
        </section>

        <!-- fixed_values: inline name/value entry editor (legacy flow). -->
        <section v-if="draft.type === 'fixed_values'" class="wp-medit__section">
          <label class="wp-medit__section-label">ENTRIES</label>
          <p class="wp-medit__hint-line">
            Tip — paste multi-line <code>name=value</code> text into a name field to bulk-add.
          </p>
          <div v-if="draft.entries.length === 0" class="wp-medit__empty">
            No entries yet.
          </div>
          <TransitionGroup v-else tag="div" name="wp-medit-list" class="wp-medit__entries">
            <datalist :id="datalistId" key="datalist">
              <option v-for="v in autocompleteOptions" :key="v" :value="v"></option>
            </datalist>
            <div v-for="(e, i) in draft.entries" :key="`row-${i}`" class="wp-medit__entry">
              <span
                class="wp-medit__status"
                :class="`wp-medit__status--${entryStatuses[i]}`"
                :title="statusTooltip(entryStatuses[i])"
                aria-hidden="true"
              >
                <i v-if="entryStatuses[i] === 'ok'" class="pi pi-check"></i>
                <i v-else-if="entryStatuses[i] === 'dup'" class="pi pi-exclamation-circle"></i>
                <i v-else-if="entryStatuses[i] === 'shadow'" class="pi pi-info-circle"></i>
              </span>
              <div class="wp-medit__entry-var-wrap">
                <span class="wp-medit__entry-prefix" aria-hidden="true">$</span>
                <input
                  :ref="(el) => { if (i === 0) firstNameInput = el as HTMLInputElement }"
                  class="wp-medit__entry-input wp-medit__entry-var"
                  :value="e.variable_name"
                  placeholder="name"
                  spellcheck="false"
                  :list="datalistId"
                  @input="(ev) => updateVarName(i, (ev.target as HTMLInputElement).value)"
                  @paste="(ev) => onNamePaste(i, ev)"
                />
              </div>
              <input
                v-model="e.value"
                class="wp-medit__entry-input wp-medit__entry-value"
                placeholder="value"
                @keydown.enter="(ev) => onValueEnter(i, ev)"
              />
              <button
                type="button"
                aria-label="remove entry"
                title="Remove entry"
                class="wp-medit__entry-remove"
                @click="removeEntry(i)"
              ><i class="pi pi-times" aria-hidden="true"></i></button>
            </div>
          </TransitionGroup>
          <button type="button" class="wp-medit__add-entry" @click="addEntry">
            <i class="pi pi-plus" aria-hidden="true"></i> add entry
          </button>
        </section>

        <!-- Wildcard kind: mode picker + per-option editor. Saves
             into `draft.instance.{mode, enabled_options,
             option_weights, pinned_option_id}`. Engine merges these
             onto the library snapshot at run time so the library row
             stays pristine. -->
        <section v-if="draft.type === 'wildcard'" class="wp-medit__section">
          <label class="wp-medit__section-label">PICK MODE</label>
          <div class="wp-medit__mode-tabs" role="tablist">
            <button
              v-for="m in PICK_MODES"
              :key="m.id"
              type="button"
              role="tab"
              class="wp-medit__mode-tab"
              :class="{ 'wp-medit__mode-tab--active': currentMode === m.id }"
              :aria-selected="currentMode === m.id"
              :title="m.hint"
              @click="setMode(m.id)"
            >{{ m.label }}</button>
          </div>
          <p class="wp-medit__hint-line">
            {{ PICK_MODES.find(m => m.id === currentMode)?.hint }}
          </p>

          <!-- Sub-category chips — only meaningful in Subset mode and
               only when the wildcard actually declares sub-categories.
               Click toggles inclusion in `instance.category_filter`. -->
          <div
            v-if="currentMode === 'subcategory' && wildcardSubCategories.length > 0"
            class="wp-medit__cat-row"
          >
            <label class="wp-medit__section-label wp-medit__cat-label">SUB-CATEGORIES</label>
            <div class="wp-medit__cat-chips">
              <button
                v-for="cat in wildcardSubCategories"
                :key="cat"
                type="button"
                class="wp-medit__cat-chip"
                :class="{ 'wp-medit__cat-chip--active': isCategoryActive(cat) }"
                @click="toggleCategory(cat)"
              >{{ cat }}</button>
            </div>
          </div>

          <div class="wp-medit__opt-head">
            <label class="wp-medit__section-label">OPTIONS · {{ visibleWildcardOptions.length }}<span v-if="visibleWildcardOptions.length !== wildcardOptions.length" class="wp-medit__opt-total"> / {{ wildcardOptions.length }}</span></label>
            <div class="wp-medit__opt-bulk">
              <button
                v-if="currentMode === 'subcategory'"
                type="button"
                class="wp-medit__bulk-btn"
                :title="allOptionsEnabled ? 'Disable all options' : 'Enable all options'"
                @click="bulkSetEnabled(!allOptionsEnabled)"
              >
                <i :class="['pi', allOptionsEnabled ? 'pi-eye-slash' : 'pi-eye']" aria-hidden="true"></i>
                {{ allOptionsEnabled ? 'disable all' : 'enable all' }}
              </button>
              <button
                type="button"
                class="wp-medit__bulk-btn"
                :disabled="!hasInstanceOverrides"
                title="Clear all instance overrides (revert to library defaults)"
                @click="resetOverrides"
              >
                <i class="pi pi-refresh" aria-hidden="true"></i>
                reset
              </button>
            </div>
          </div>

          <div v-if="wildcardOptions.length === 0" class="wp-medit__empty">
            No options in this wildcard.
          </div>
          <div v-else-if="visibleWildcardOptions.length === 0" class="wp-medit__empty">
            No options match the selected sub-categories.
          </div>
          <div
            v-else
            class="wp-medit__opts"
            :data-mode="currentMode"
          >
            <div
              v-for="(opt, i) in visibleWildcardOptions"
              :key="opt.id ?? `idx-${i}`"
              class="wp-medit__opt"
              :class="{
                'wp-medit__opt--disabled': currentMode === 'subcategory' && !isOptionEnabled(opt),
                'wp-medit__opt--pinned':   currentMode === 'pinned' && isOptionPinned(opt),
              }"
            >
              <!-- Selector cell — mode-dependent: checkbox, radio, or none. -->
              <span class="wp-medit__opt-sel">
                <input
                  v-if="currentMode === 'subcategory'"
                  type="checkbox"
                  class="wp-medit__opt-toggle"
                  :checked="isOptionEnabled(opt)"
                  :aria-label="`Enable option ${opt.value ?? i + 1}`"
                  @change="(ev) => setOptionEnabled(opt, (ev.target as HTMLInputElement).checked)"
                />
                <input
                  v-else-if="currentMode === 'pinned'"
                  type="radio"
                  class="wp-medit__opt-radio"
                  name="wp-medit-pinned"
                  :checked="isOptionPinned(opt)"
                  :disabled="!opt.id"
                  :aria-label="`Pin option ${opt.value ?? i + 1}`"
                  @change="opt.id && setPinnedId(opt.id)"
                />
                <i v-else class="pi pi-circle-fill wp-medit__opt-bullet" aria-hidden="true"></i>
              </span>

              <span class="wp-medit__opt-value" :title="opt.value">{{ displayValue(opt) }}</span>

              <!-- Weight cell — hidden in pinned mode (weight is meaningless). -->
              <span v-if="currentMode !== 'pinned'" class="wp-medit__opt-weight-wrap">
                <span
                  v-if="isWeightOverridden(opt)"
                  class="wp-medit__opt-weight-dot"
                  title="Weight overridden — click reset to revert"
                  aria-hidden="true"
                ></span>
                <input
                  type="number"
                  class="wp-medit__opt-weight"
                  :class="{ 'wp-medit__opt-weight--overridden': isWeightOverridden(opt) }"
                  step="0.1"
                  min="0"
                  :aria-label="`Weight for option ${opt.value ?? i + 1}`"
                  :value="effectiveWeight(opt)"
                  :disabled="!opt.id"
                  :title="opt.id ? 'Weight override (replaces library weight)' : 'Option missing id — weight not editable'"
                  @change="(ev) => setOptionWeight(opt, (ev.target as HTMLInputElement).value)"
                />
              </span>
            </div>
          </div>
          <!-- EXECUTION — per-instance behaviour toggles that don't
               relate to which option gets picked. Lock pins the
               wildcard's RNG to a derived seed so the pick stays
               stable across runs; Internal hides the bound var from
               the public PIPELINE_CONTEXT payload. -->
          <div class="wp-medit__exec">
            <label class="wp-medit__section-label">EXECUTION</label>
            <div class="wp-medit__exec-row">
              <button
                type="button"
                class="wp-medit__exec-toggle"
                :class="{ 'wp-medit__exec-toggle--on': lockEnabled }"
                :title="lockEnabled ? 'Locked — pick frozen across runs. Click to unlock.' : 'Lock — freeze the pick across runs (RNG seeded from this value + var name).'"
                @click="toggleLock"
              >
                <i :class="['pi', lockEnabled ? 'pi-lock' : 'pi-lock-open']" aria-hidden="true"></i>
                Lock
              </button>
              <input
                v-if="lockEnabled"
                type="number"
                class="wp-medit__exec-seed"
                :value="draft.instance?.locked_seed ?? 0"
                aria-label="Locked seed"
                title="Locked seed (any 32-bit integer)"
                @change="(ev) => setLockedSeed((ev.target as HTMLInputElement).value)"
              />
              <button
                v-if="lockEnabled"
                type="button"
                class="wp-medit__exec-reroll"
                title="Reroll the locked seed"
                @click="rerollLockedSeed"
              ><i class="pi pi-refresh" aria-hidden="true"></i></button>
              <span class="wp-medit__exec-spacer"></span>
              <button
                type="button"
                class="wp-medit__exec-toggle"
                :class="{ 'wp-medit__exec-toggle--on': internalEnabled }"
                :title="internalEnabled ? 'Internal — bound var hidden from public payload. Click to publish.' : 'Internal — hide bindings from the public PIPELINE_CONTEXT payload (downstream modules can still read them).'"
                @click="toggleInternal"
              >
                <i :class="['pi', internalEnabled ? 'pi-eye-slash' : 'pi-eye']" aria-hidden="true"></i>
                Internal
              </button>
            </div>
          </div>

          <a
            class="wp-medit__spa-link"
            :href="spaEditorHref"
            target="_blank"
            rel="noopener"
          >
            <i class="pi pi-external-link" aria-hidden="true"></i>
            Edit options in SPA library
          </a>
        </section>

        <!-- Combine kind preview -->
        <section v-else-if="draft.type === 'combine'" class="wp-medit__section">
          <label class="wp-medit__section-label">TEMPLATE</label>
          <pre
            v-if="combineTemplate"
            class="wp-medit__readonly-mono wp-medit__preview-block"
            data-testid="combine-preview-template"
          >{{ combineTemplate }}</pre>
          <p v-else class="wp-medit__hint-line">(empty template)</p>

          <label class="wp-medit__section-label" style="margin-top: 12px;">OUTPUT</label>
          <p class="wp-medit__hint-line">
            <span class="wp-medit__chip" data-testid="combine-preview-output">→ ${{ combineOutputVar || "?" }}</span>
          </p>

          <a
            class="wp-medit__spa-link"
            :href="spaEditorHref"
            target="_blank"
            rel="noopener"
          >
            <i class="pi pi-external-link" aria-hidden="true"></i>
            Open in SPA editor
          </a>
        </section>

        <!-- Derivation kind preview -->
        <section v-else-if="draft.type === 'derivation'" class="wp-medit__section">
          <label class="wp-medit__section-label">RULES ({{ derivationRules.length }})</label>
          <p v-if="derivationRules.length === 0" class="wp-medit__hint-line">(no rules)</p>
          <div
            v-else
            class="wp-medit__preview-block wp-medit__derivation-rules"
            data-testid="derivation-preview-rules"
          >
            <div
              v-for="(rule, idx) in derivationRules"
              :key="rule.id ?? idx"
              class="wp-medit__derivation-rule"
            >
              <div
                v-for="(branch, bi) in rule.branches"
                :key="`b-${bi}`"
                class="wp-medit__derivation-row"
              >
                <span class="wp-medit__readonly-mono">if ${{ branch.condition.var }} {{ formatOp(branch.condition.op) }} "{{ branch.condition.value }}"</span>
                <span class="wp-medit__derivation-arrow"> → </span>
                <span class="wp-medit__readonly-mono">${{ branch.action.target_var }} {{ formatMode(branch.action.mode) }} "{{ branch.action.value }}"</span>
              </div>
              <div v-if="rule.else" class="wp-medit__derivation-row wp-medit__derivation-row--else">
                <span class="wp-medit__readonly-mono">else</span>
                <span class="wp-medit__derivation-arrow"> → </span>
                <span class="wp-medit__readonly-mono">${{ rule.else.action.target_var }} {{ formatMode(rule.else.action.mode) }} "{{ rule.else.action.value }}"</span>
              </div>
            </div>
          </div>

          <a
            class="wp-medit__spa-link"
            :href="spaEditorHref"
            target="_blank"
            rel="noopener"
          >
            <i class="pi pi-external-link" aria-hidden="true"></i>
            Open in SPA editor
          </a>
        </section>

        <!-- Constraint kind preview -->
        <section v-else-if="draft.type === 'constraint'" class="wp-medit__section">
          <label class="wp-medit__section-label">SOURCE → TARGET</label>
          <p class="wp-medit__hint-line" data-testid="constraint-preview-bindings">
            <span class="wp-medit__chip">${{ constraintSourceLabel }}</span>
            <span class="wp-medit__derivation-arrow"> → </span>
            <span class="wp-medit__chip">${{ constraintTargetLabel }}</span>
          </p>

          <label class="wp-medit__section-label" style="margin-top: 12px;">MATRIX</label>
          <p class="wp-medit__hint-line" data-testid="constraint-preview-dims">
            {{ constraintRowCount }} sub-cat{{ constraintRowCount === 1 ? "" : "s" }}
            × {{ constraintColCount }} sub-cat{{ constraintColCount === 1 ? "" : "s" }}
          </p>

          <label v-if="constraintExceptions.length > 0" class="wp-medit__section-label" style="margin-top: 12px;">
            EXCEPTIONS ({{ constraintExceptions.length }})
          </label>
          <ul
            v-if="constraintExceptions.length > 0"
            class="wp-medit__preview-block wp-medit__exception-list"
            data-testid="constraint-preview-exceptions"
          >
            <li v-for="(ex, i) in constraintExceptions" :key="`ex-${i}`">
              <span class="wp-medit__readonly-mono">"{{ ex.source }}" → "{{ ex.target }}"</span>
              <span class="wp-medit__chip wp-medit__chip--small">{{ ex.mode }} ×{{ ex.factor }}</span>
            </li>
          </ul>

          <a
            class="wp-medit__spa-link"
            :href="spaEditorHref"
            target="_blank"
            rel="noopener"
          >
            <i class="pi pi-external-link" aria-hidden="true"></i>
            Open in SPA editor
          </a>
        </section>

        <!-- Pipeline + any other future kind — keep the existing thin placeholder -->
        <section v-else-if="draft.type !== 'fixed_values'" class="wp-medit__section">
          <label class="wp-medit__section-label">SNAPSHOT</label>
          <p class="wp-medit__hint-line">
            <strong>{{ draft.type }}</strong> kind has no per-instance overrides yet.
            Edit the library row in the SPA to change behaviour.
          </p>
          <div class="wp-medit__readonly">
            <div class="wp-medit__readonly-row">
              <span class="wp-medit__readonly-key">UUID</span>
              <span class="wp-medit__readonly-val wp-medit__readonly-mono">{{ draft.id }}</span>
            </div>
            <div v-if="draft.payload_hash" class="wp-medit__readonly-row">
              <span class="wp-medit__readonly-key">Payload hash</span>
              <span class="wp-medit__readonly-val wp-medit__readonly-mono">{{ draft.payload_hash.slice(0, 12) }}…</span>
            </div>
          </div>
          <a
            class="wp-medit__spa-link"
            :href="spaEditorHref"
            target="_blank"
            rel="noopener"
          >
            <i class="pi pi-external-link" aria-hidden="true"></i>
            Open in SPA editor
          </a>
        </section>
      </div>

      <footer class="wp-medit__foot">
        <span class="wp-medit__hint">Esc to cancel · Ctrl+Enter to save</span>
        <div class="wp-medit__buttons">
          <button type="button" class="wp-medit__btn" @click="cancel">Cancel</button>
          <button type="button" class="wp-medit__btn wp-medit__btn--primary" @click="save">Save</button>
        </div>
      </footer>
    </div>
  </ModalShell>
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-medit, .wp-medit * { box-sizing: border-box; }
.wp-medit {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  width: 540px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
}

.wp-medit__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-brand-gradient);
  position: relative;
}
.wp-medit__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.wp-medit__head > * { position: relative; z-index: 1; }
.wp-medit__head-icon {
  font-size: 14px;
  color: var(--wp-text2);
  flex-shrink: 0;
}
.wp-medit__head-icon.type-fixed_values { color: var(--wp-rose); }
.wp-medit__name-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px;
  min-width: 0;
}
.wp-medit__name-input:focus { outline: none; border-color: var(--wp-accent); }
.wp-medit__close {
  background: none;
  border: none;
  color: var(--wp-text3);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 6px;
}
.wp-medit__close:hover { color: var(--wp-text); }

.wp-medit__body {
  padding: 12px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}
.wp-medit__section { display: flex; flex-direction: column; gap: 6px; }
.wp-medit__section-label {
  font-size: 9px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3);
  letter-spacing: 0.08em;
  font-weight: 600;
}
.wp-medit__hint-line {
  font-size: 11px;
  color: var(--wp-text3);
  margin: 0 0 2px;
}
.wp-medit__hint-line code {
  font-family: var(--wp-font-mono, monospace);
  background: var(--wp-bg);
  padding: 0 4px;
  border-radius: 2px;
}

.wp-medit__meta-input {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  padding: 5px 8px;
  width: 100%;
}
.wp-medit__meta-input:focus { outline: none; border-color: var(--wp-accent); }

.wp-medit__empty {
  color: var(--wp-text3);
  font-style: italic;
  padding: 6px 0;
}

.wp-medit__entries {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.wp-medit__entry {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.wp-medit__entry > .wp-medit__entry-var-wrap,
.wp-medit__entry > .wp-medit__entry-value {
  flex: 1 1 0;
  min-width: 0;
}

/* Per-entry validity glyph */
.wp-medit__status {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  cursor: help;
}
.wp-medit__status--empty,
.wp-medit__status--empty i { display: none; }
.wp-medit__status--ok i { color: var(--wp-green); }
.wp-medit__status--shadow i { color: var(--wp-accent); }
.wp-medit__status--dup i { color: var(--wp-red); }

.wp-medit__entry-var-wrap {
  position: relative;
  min-width: 0;
}
.wp-medit__entry-prefix {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--wp-accent);
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
}
.wp-medit__entry-var { padding-left: 16px !important; }
.wp-medit__entry-input {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  padding: 5px 8px;
  width: 100%;
  min-width: 0;
}
.wp-medit__entry-input:focus { outline: none; border-color: var(--wp-accent); }
.wp-medit__entry-remove {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
}
.wp-medit__entry-remove:hover { color: var(--wp-red); }

.wp-medit__add-entry {
  background: none;
  border: 1px dashed var(--wp-border2);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  cursor: pointer;
  font-size: 11px;
  padding: 5px;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-medit__add-entry:hover { color: var(--wp-accent); border-color: var(--wp-accent); }

.wp-medit__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-top: 1px solid var(--wp-border);
  gap: 12px;
}
.wp-medit__hint {
  font-size: 10px;
  color: var(--wp-text3);
  font-family: var(--wp-font-mono, monospace);
}
.wp-medit__buttons { display: flex; gap: 8px; }
.wp-medit__btn {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  padding: 5px 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.wp-medit__btn:hover { border-color: var(--wp-border2); }
.wp-medit__btn--primary {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
  font-weight: 600;
}
.wp-medit__btn--primary:hover { background: var(--wp-accent2); border-color: var(--wp-accent2); }

/* Entry-row enter + reorder animations. Leave is instant — fade-out felt
 * laggy when chained with a FLIP move to fill the gap. */
.wp-medit-list-move { transition: transform 0.2s ease-out; }
.wp-medit-list-enter-active { transition: opacity 0.18s, transform 0.18s; }
.wp-medit-list-enter-from { opacity: 0; transform: translateY(-6px); }

/* Library-picked-snapshot panel (non-fixed_values kinds). Read-only
 * payload preview + SPA deep-link. Stays minimal on purpose — major
 * edits route through the SPA editor. */
.wp-medit__readonly {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 6px 0 10px;
}
.wp-medit__readonly-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 12px;
}
.wp-medit__readonly-key {
  flex-shrink: 0;
  width: 110px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text3);
  font-size: 10.5px;
  font-weight: 600;
}
.wp-medit__readonly-val {
  flex: 1;
  min-width: 0;
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-medit__readonly-mono {
  font-family: var(--wp-font-mono);
  color: var(--wp-text2);
  font-size: 11px;
}

/* Kind-preview blocks (combine / derivation / constraint). Read-only,
 * scrollable surfaces sized to keep the modal compact even when the
 * snapshot payload is large. */
.wp-medit__preview-block {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 8px 10px;
  max-height: 220px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.wp-medit__derivation-rules { display: flex; flex-direction: column; gap: 8px; }
.wp-medit__derivation-rule {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 6px 8px;
  display: flex; flex-direction: column; gap: 2px;
}
.wp-medit__derivation-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.wp-medit__derivation-row--else { color: var(--wp-text2); }
.wp-medit__derivation-arrow { color: var(--wp-text3); padding: 0 4px; }
.wp-medit__exception-list {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.wp-medit__exception-list li {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
/* Inline pill used for source/target labels + exception mode markers in
 * the kind-preview blocks. Base class kept here so future call-sites can
 * reuse it; --small modifier shrinks it for the dense exception list. */
.wp-medit__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.wp-medit__chip--small { font-size: 10.5px; padding: 1px 6px; }

.wp-medit__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg3);
  color: var(--wp-text);
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-medit__spa-link:hover {
  background: var(--wp-bg4);
  border-color: var(--wp-accent);
  color: var(--wp-accent2);
}
.wp-medit__spa-link .pi { font-size: 10px; }

/* Read-only name header for snapshot kinds (non-fixed_values). */
.wp-medit__name-readonly {
  flex: 1;
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-medit__name-kind {
  color: var(--wp-text3);
  font-weight: 400;
  font-size: 11px;
  margin-left: 4px;
  font-family: var(--wp-font-mono, monospace);
}

/* Wildcard option editor. Three-column row: enable / value / weight.
 * Disabled rows fade so the picked-from set is visually obvious. */
.wp-medit__opt-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.wp-medit__opt-bulk {
  display: flex;
  gap: 4px;
}
.wp-medit__bulk-btn {
  background: none;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  cursor: pointer;
  font-size: 10px;
  font-family: var(--wp-font-mono, monospace);
  padding: 3px 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-medit__bulk-btn:hover:not(:disabled) {
  color: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-medit__bulk-btn:disabled { opacity: 0.4; cursor: default; }
.wp-medit__bulk-btn .pi { font-size: 10px; }

.wp-medit__opts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg);
  padding: 4px;
}
.wp-medit__opt {
  display: grid;
  grid-template-columns: 18px 1fr 64px;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 3px;
  transition: background 0.1s;
}
.wp-medit__opt:hover { background: var(--wp-bg2); }
.wp-medit__opt--disabled .wp-medit__opt-value {
  opacity: 0.4;
  text-decoration: line-through;
}
.wp-medit__opt-toggle {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--wp-accent);
}
.wp-medit__opt-value {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  color: var(--wp-text2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.wp-medit__opt-weight-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.wp-medit__opt-weight {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 3px 6px;
  width: 100%;
  text-align: right;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
/* Drop the native number spinners — they look noisy in tight cells.
 * Users tweak weights via keyboard / paste; the override dot signals
 * non-default state without needing visible spinners. */
.wp-medit__opt-weight::-webkit-outer-spin-button,
.wp-medit__opt-weight::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.wp-medit__opt-weight {
  -moz-appearance: textfield;
  appearance: textfield;
}
.wp-medit__opt-weight:hover:not(:disabled) {
  border-color: var(--wp-border2);
  color: var(--wp-text);
}
.wp-medit__opt-weight:focus {
  outline: none;
  border-color: var(--wp-accent);
  background: var(--wp-bg);
  color: var(--wp-text);
}
.wp-medit__opt-weight:disabled { opacity: 0.4; cursor: not-allowed; }
.wp-medit__opt-weight--overridden {
  color: var(--wp-accent2, var(--wp-accent));
  border-color: var(--wp-accent);
  font-weight: 600;
}

/* Override-indicator — tiny dot pinned to the weight cell's left edge.
 * Hovers over the input rather than reflowing layout, so toggle on/off
 * is purely visual. */
.wp-medit__opt-weight-dot {
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--wp-accent);
  box-shadow: 0 0 4px var(--wp-accent);
  pointer-events: none;
}

/* Mode tabs — segmented control. Active tab gets the accent
 * underline + brighter text; inactive tabs stay muted. */
.wp-medit__mode-tabs {
  display: flex;
  gap: 0;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 2px;
  margin-bottom: 4px;
}
.wp-medit__mode-tab {
  flex: 1;
  background: none;
  border: none;
  border-radius: calc(var(--wp-radius-sm) - 2px);
  color: var(--wp-text3);
  cursor: pointer;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  font-weight: 600;
  padding: 5px 8px;
  transition: background 0.12s, color 0.12s;
}
.wp-medit__mode-tab:hover:not(.wp-medit__mode-tab--active) {
  color: var(--wp-text2);
}
.wp-medit__mode-tab--active {
  background: var(--wp-accent);
  color: #fff;
}

/* Selector cell — checkbox in subset mode, radio in pinned mode,
 * filler dot in random mode (keeps grid columns aligned). */
.wp-medit__opt-sel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}
.wp-medit__opt-bullet {
  font-size: 4px !important;
  color: var(--wp-text3);
}
.wp-medit__opt-radio {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--wp-accent);
}
.wp-medit__opt-radio:disabled { cursor: not-allowed; opacity: 0.4; }

/* Pinned highlight — accent-tinted row + thin left rule */
.wp-medit__opt--pinned {
  background: color-mix(in srgb, var(--wp-accent) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--wp-accent);
}

/* Hide weight column entirely in pinned mode (template already
 * conditional-renders it, but tighten the grid template too so the
 * value cell can stretch full-width). */
.wp-medit__opts[data-mode="pinned"] .wp-medit__opt {
  grid-template-columns: 18px 1fr;
}

/* Sub-category chip row — toggle-style multiselect above the option
 * list. Active chips get accent fill; inactive stay muted with a
 * border outline. Click toggles membership in `category_filter`. */
.wp-medit__cat-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 4px;
}
.wp-medit__cat-label {
  margin-bottom: 0;
}
.wp-medit__cat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wp-medit__cat-chip {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  color: var(--wp-text3);
  cursor: pointer;
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 3px 10px;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-medit__cat-chip:hover {
  border-color: var(--wp-border2);
  color: var(--wp-text2);
}
.wp-medit__cat-chip--active {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
}
.wp-medit__cat-chip--active:hover { filter: brightness(1.1); }

/* "Options · 4 / 12" — shows total count after a slash when filtered. */
.wp-medit__opt-total {
  color: var(--wp-text3);
  font-weight: 400;
}

/* EXECUTION row — lock + internal toggles. Compact toolbar style;
 * active toggles get accent fill so the on/off state is unambiguous. */
.wp-medit__exec {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.wp-medit__exec-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.wp-medit__exec-spacer { flex: 1; }
.wp-medit__exec-toggle {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  cursor: pointer;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.wp-medit__exec-toggle:hover { color: var(--wp-text); border-color: var(--wp-border2); }
.wp-medit__exec-toggle--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
}
.wp-medit__exec-toggle--on:hover { filter: brightness(1.1); color: #fff; }
.wp-medit__exec-toggle .pi { font-size: 11px; }

.wp-medit__exec-seed {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  padding: 4px 6px;
  width: 110px;
}
.wp-medit__exec-seed:focus { outline: none; border-color: var(--wp-accent); }
.wp-medit__exec-seed::-webkit-outer-spin-button,
.wp-medit__exec-seed::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.wp-medit__exec-seed { -moz-appearance: textfield; appearance: textfield; }

.wp-medit__exec-reroll {
  background: none;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  cursor: pointer;
  font-size: 11px;
  padding: 4px 8px;
}
.wp-medit__exec-reroll:hover { color: var(--wp-accent); border-color: var(--wp-accent); }
</style>
