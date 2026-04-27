<script setup lang="ts">
/**
 * CombineForm
 *
 * Editor for `combine` modules. A combine renders a template string with
 * `$var` placeholders into a single resolved value, then publishes that
 * value under `output_var` for downstream modules to read.
 *
 * Reference prototype: docs/design-handoff/wildcardpipeline/project/screens/editors.jsx
 *   (function CombineEditor).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import AutoComplete from "primevue/autocomplete";
import { useToast } from "primevue/usetoast";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import HistoryPanel from "../components/HistoryPanel.vue";
import { tokenizeRich } from "../utils/richTokenize";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  CombinePayload,
  ModuleHistoryEntry,
  ModuleRow,
  WildcardPayload,
  WildcardOption,
} from "../api/types";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const template = ref("");
const outputVar = ref("");
// Tracks whether the user manually edited `outputVar`; while false the
// field auto-tracks `toIdentifier(name)` like WildcardForm's var_binding.
const outputVarTouched = ref(false);
const outputVarError = ref("");
const saving = ref(false);
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);
const historyOpen = ref(false);

const PLACEHOLDER = "$first_name, a $age-year-old with $hair_color hair";

// --- Identity: tag autocomplete (same pattern as WildcardForm) ---
const tagSuggestions = ref<string[]>([]);
function searchTags(event: { query: string }) {
  const q = event.query.toLowerCase();
  const known = new Set<string>();
  for (const m of moduleStore.items) {
    for (const t of m.tags ?? []) known.add(t);
  }
  tagSuggestions.value = Array.from(known)
    .filter((t) => t.toLowerCase().includes(q) && !tags.value.includes(t))
    .slice(0, 10);
}

// --- Output var: auto-suggest from name until user edits manually. ---
watch(name, (next) => {
  if (!outputVarTouched.value) {
    outputVar.value = toIdentifier(next);
  }
});

function onOutputVarInput(value: string | undefined): void {
  outputVarTouched.value = true;
  // Strip any leading `$` the user types — the addon already shows it.
  outputVar.value = (value ?? "").replace(/^\$+/, "");
  if (outputVarError.value) outputVarError.value = "";
}

// --- Variable suggestions (everything visible upstream as a $var). ---
//
// Pulls the union of:
//   * wildcard `var_binding` (or slug fallback)
//   * fixed_values entries' `name`
//   * other combines' `output_var`
// excluding self so the editor never suggests its own output as an input.
interface VarHint { label: string; kind: "wildcard" | "fixed_values" | "combine" }
const varHints = computed<VarHint[]>(() => {
  const seen = new Set<string>();
  const out: VarHint[] = [];
  for (const m of moduleStore.items) {
    if (props.id && m.id === props.id) continue; // exclude self
    if (m.type === "wildcard") {
      const p = (m.payload ?? {}) as Partial<WildcardPayload>;
      const binding = (p.var_binding && p.var_binding.trim()) || toIdentifier(m.name);
      if (binding && !seen.has(binding)) {
        seen.add(binding);
        out.push({ label: binding, kind: "wildcard" });
      }
    } else if (m.type === "fixed_values") {
      const values = ((m.payload ?? {}) as { values?: { name?: string }[] }).values ?? [];
      for (const row of values) {
        const n = (row.name ?? "").replace(/^\$+/, "").trim();
        if (n && !seen.has(n)) {
          seen.add(n);
          out.push({ label: n, kind: "fixed_values" });
        }
      }
    } else if (m.type === "combine") {
      const p = (m.payload ?? {}) as Partial<CombinePayload>;
      const o = (p.output_var ?? "").replace(/^\$+/, "").trim();
      if (o && !seen.has(o)) {
        seen.add(o);
        out.push({ label: o, kind: "combine" });
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
});

const varSuggestions = computed<string[]>(() => varHints.value.map((h) => h.label));
const hintByLabel = computed<Map<string, VarHint>>(() => {
  const m = new Map<string, VarHint>();
  for (const h of varHints.value) m.set(h.label, h);
  return m;
});

// --- Detected inputs: extract `$ident` from template, skipping `$$` escapes. ---
const detected = computed<string[]>(() => {
  const tokens = tokenizeRich(template.value);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.kind === "var" && t.meta?.name) {
      if (!seen.has(t.meta.name)) {
        seen.add(t.meta.name);
        out.push(t.meta.name);
      }
    }
  }
  return out;
});

// --- Live preview: best-effort resolution of each detected $var. ---
//
// Each render picks a fresh sample so authors can re-roll. Only `wildcard`
// kinds change between renders (random pick from options); fixed/combine
// values render their first value / placeholder respectively.
const previewSeed = ref(0);

function pickWildcardValue(mod: ModuleRow): string {
  const p = (mod.payload ?? {}) as Partial<WildcardPayload>;
  const opts: WildcardOption[] = p.options ?? [];
  if (!opts.length) return `<empty:${mod.name}>`;
  // Weighted random pick.
  let total = 0;
  for (const o of opts) total += Math.max(0, o.weight ?? 1);
  if (total <= 0) return opts[0].value ?? "";
  let r = Math.random() * total;
  for (const o of opts) {
    r -= Math.max(0, o.weight ?? 1);
    if (r <= 0) return o.value ?? "";
  }
  return opts[opts.length - 1].value ?? "";
}

function pickFixedValue(varName: string): string | null {
  for (const m of moduleStore.items) {
    if (m.type !== "fixed_values") continue;
    const values = ((m.payload ?? {}) as { values?: { name?: string; value?: string }[] }).values ?? [];
    for (const row of values) {
      const n = (row.name ?? "").replace(/^\$+/, "").trim();
      if (n === varName) return row.value ?? "";
    }
  }
  return null;
}

function findWildcardForVar(varName: string): ModuleRow | null {
  for (const m of moduleStore.items) {
    if (m.type !== "wildcard") continue;
    const p = (m.payload ?? {}) as Partial<WildcardPayload>;
    const binding = (p.var_binding && p.var_binding.trim()) || toIdentifier(m.name);
    if (binding === varName) return m;
  }
  return null;
}

const livePreview = computed<string>(() => {
  // Reactive read of the seed so re-roll bumps invalidate this computed.
  void previewSeed.value;
  const tpl = template.value;
  if (!tpl) return "";
  // Replace each $ident (skipping $$) with a sampled value. Use the
  // tokenizer to find positions so we don't accidentally rewrite a
  // ${something} block or a `$$` escape.
  const tokens = tokenizeRich(tpl);
  let out = "";
  for (const t of tokens) {
    if (t.kind === "var" && t.meta?.name) {
      const v = t.meta.name;
      const wc = findWildcardForVar(v);
      if (wc) {
        out += pickWildcardValue(wc);
        continue;
      }
      const fv = pickFixedValue(v);
      if (fv != null) {
        out += fv;
        continue;
      }
      out += `<unbound:${v}>`;
    } else if (t.kind === "escape" && t.raw === "$$") {
      out += "$";
    } else {
      out += t.raw;
    }
  }
  return out;
});

let rerollTimer: number | null = null;
function reroll(): void {
  previewSeed.value++;
}
function startRerollTimer(): void {
  stopRerollTimer();
  rerollTimer = window.setInterval(reroll, 1500);
}
function stopRerollTimer(): void {
  if (rerollTimer != null) {
    window.clearInterval(rerollTimer);
    rerollTimer = null;
  }
}

onMounted(async () => {
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchAll()]);
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
      historyEntries.value = readHistory(row.payload);
    } catch {
      toast.add({ severity: "error", summary: "Combine not found", life: 3000 });
      router.replace("/combines");
    }
  }
  startRerollTimer();
});

onBeforeUnmount(stopRerollTimer);

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
  historyOpen.value = false;
  toast.add({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  if (!name.value.trim()) {
    toast.add({ severity: "warn", summary: "Name required", life: 2000 });
    return;
  }
  const finalOutput = (outputVar.value.trim()) || toIdentifier(name.value);
  if (!VALID_IDENTIFIER_RE.test(finalOutput)) {
    outputVarError.value = "Use letters, digits, underscores; must not start with a digit.";
    toast.add({ severity: "warn", summary: "Invalid output variable", life: 2500 });
    return;
  }
  outputVarError.value = "";
  saving.value = true;
  try {
    const payload: CombinePayload = {
      template: template.value,
      output_var: finalOutput,
      input_vars: [...detected.value],
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
    } else {
      await moduleStore.create({
        type: "combine",
        name: name.value,
        description: description.value,
        category_id: categoryId.value,
        tags: tags.value,
        payload: newPayload,
      });
    }
    toast.add({ severity: "success", summary: "Saved", detail: name.value, life: 2000 });
    router.push("/combines");
  } catch (e) {
    toast.add({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="form-page">
    <div class="form-page__header">
      <RouterLink to="/combines" class="text-xs text-wp-text2 hover:text-wp-text">
        <i class="pi pi-angle-left text-xs" /> Combines
      </RouterLink>
      <h1 class="text-xl font-semibold m-0 mt-1">{{ isEdit ? "Edit combine" : "New combine" }}</h1>
    </div>

    <div class="form-page__body">
      <!-- Identity ------------------------------------------------------- -->
      <section class="form-section">
        <h2 class="form-section__label">Identity</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="cb-name" class="block text-xs text-wp-text2 mb-1">Name</label>
            <InputText id="cb-name" v-model="name" class="w-full" />
          </div>
          <div>
            <label for="cb-cat" class="block text-xs text-wp-text2 mb-1">Category</label>
            <Select
              id="cb-cat" v-model="categoryId"
              :options="categoryStore.items" option-label="name" option-value="id"
              placeholder="None" show-clear class="w-full"
            />
          </div>
          <div class="col-span-2">
            <label for="cb-desc" class="block text-xs text-wp-text2 mb-1">Description</label>
            <Textarea id="cb-desc" v-model="description" rows="2" class="w-full" />
          </div>
          <div class="col-span-2">
            <label for="cb-tags" class="block text-xs text-wp-text2 mb-1">Tags</label>
            <AutoComplete
              id="cb-tags"
              v-model="tags"
              multiple
              typeahead
              :suggestions="tagSuggestions"
              placeholder="Type a tag and press Enter…"
              class="w-full"
              @complete="searchTags"
            />
          </div>
        </div>
      </section>

      <!-- Output --------------------------------------------------------- -->
      <section class="form-section">
        <h2 class="form-section__label">Output</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="cb-output" class="block text-xs text-wp-text2 mb-1">Output variable</label>
            <InputGroup>
              <InputGroupAddon><i class="pi pi-dollar" /></InputGroupAddon>
              <InputText
                id="cb-output"
                :model-value="outputVar"
                data-test="cb-output-var"
                placeholder="subject_phrase"
                :class="{ 'p-invalid': !!outputVarError }"
                @update:model-value="onOutputVarInput"
              />
            </InputGroup>
            <p class="text-xs text-wp-text2 mt-1">
              Downstream modules will read this combine's value as
              <span class="cb-mono">${{ outputVar || "name" }}</span>.
            </p>
            <p v-if="outputVarError" class="text-xs text-wp-danger mt-1" data-test="cb-output-error">
              {{ outputVarError }}
            </p>
            <p v-else class="text-xs text-wp-text3 mt-1">
              Must be a valid identifier (letters, digits, underscores).
            </p>
          </div>
        </div>
      </section>

      <!-- Template ------------------------------------------------------- -->
      <section class="form-section">
        <h2 class="form-section__label">Template</h2>
        <RichTextInput
          v-model="template"
          :multiline="true"
          :rows="4"
          :placeholder="PLACEHOLDER"
          :var-suggestions="varSuggestions"
          aria-label="Combine template"
          data-test="cb-template"
        />
        <p class="text-xs text-wp-text2 mt-1">
          Type <span class="cb-mono">$</span> to autocomplete known variables. Use
          <span class="cb-mono">$$</span> to escape a literal dollar sign.
        </p>
      </section>

      <!-- Detected inputs ------------------------------------------------ -->
      <section class="form-section">
        <h2 class="form-section__label">
          Detected inputs <span class="cb-count">({{ detected.length }})</span>
        </h2>
        <div v-if="detected.length" class="cb-chip-list" data-test="cb-detected">
          <span
            v-for="d in detected"
            :key="d"
            class="cb-chip"
            :data-kind="hintByLabel.get(d)?.kind ?? 'unknown'"
          >
            <span
              v-if="hintByLabel.get(d)"
              class="cb-chip__dot"
              :data-kind="hintByLabel.get(d)?.kind"
            />
            <i v-else class="pi pi-question-circle cb-chip__icon" aria-hidden="true" />
            ${{ d }}
          </span>
        </div>
        <p v-else class="text-xs text-wp-text3" data-test="cb-detected-empty">
          No <span class="cb-mono">$variable</span> references yet — type
          <span class="cb-mono">$</span> in the template above.
        </p>
      </section>

      <!-- Preview -------------------------------------------------------- -->
      <section class="form-section">
        <div class="flex items-center justify-between mb-2">
          <h2 class="form-section__label m-0">Preview</h2>
          <Button
            label="Re-roll"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            outlined
            data-test="cb-reroll"
            @click="reroll"
          />
        </div>
        <div class="cb-preview">
          <div class="cb-preview__row">
            <span class="cb-preview__label">Template</span>
            <span class="cb-preview__value">
              <RichTextPreview v-if="template" :value="template" />
              <span v-else class="text-wp-text3">(empty template)</span>
            </span>
          </div>
          <div class="cb-preview__row">
            <span class="cb-preview__label">Sample</span>
            <span class="cb-preview__value cb-preview__sample" data-test="cb-preview-sample">
              {{ livePreview || "(no template)" }}
            </span>
          </div>
          <div class="cb-preview__row">
            <span class="cb-preview__label">Stored as</span>
            <span class="cb-preview__value cb-mono">${{ outputVar || "output" }}</span>
          </div>
        </div>
      </section>
    </div>

    <div class="form-page__footer">
      <Button
        v-if="historyEntries.length"
        :label="`History (${historyEntries.length})`"
        icon="pi pi-history"
        severity="secondary"
        outlined
        data-test="history-btn"
        @click="historyOpen = true"
      />
      <div class="form-page__footer-spacer" />
      <Button label="Cancel" severity="secondary" outlined @click="router.push('/combines')" />
      <Button label="Save" icon="pi pi-check" severity="primary" :loading="saving" data-test="save-btn" @click="save" />
    </div>
    <HistoryPanel
      :open="historyOpen"
      :entries="historyEntries"
      @update:open="(v) => (historyOpen = v)"
      @restore="applyRestore"
    />
  </div>
</template>

<style scoped>
.form-page { display: flex; flex-direction: column; min-height: calc(100vh - 56px); }
.form-page__header { padding: 24px 24px 0; }
.form-page__body { padding: 16px 24px 96px; max-width: 56rem; flex: 1; }
.form-page__footer {
  position: sticky; bottom: 0;
  background: var(--wp-bg);
  border-top: 1px solid var(--wp-border);
  padding: 12px 24px;
  display: flex; gap: 8px; align-items: center;
}
.form-page__footer-spacer { flex: 1; }
.form-section { margin-bottom: 24px; }
.form-section__label {
  font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--wp-text2);
  margin: 0 0 8px 0;
}
.cb-mono {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-accent-text, #c4b5fd);
}
.cb-count {
  text-transform: none;
  letter-spacing: 0;
  color: var(--wp-text3, #6e6e7c);
  font-weight: 400;
}

/* Detected-inputs chip list ------------------------------------------- */
.cb-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  font-weight: 500;
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 12%, transparent);
  color: var(--wp-accent-text, #c4b5fd);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 32%, transparent);
}
.cb-chip[data-kind="unknown"] {
  background: color-mix(in oklab, var(--wp-warn, #f59e0b) 10%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn, #f59e0b) 32%, transparent);
  color: var(--wp-warn, #fcd34d);
}
.cb-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--wp-text-muted);
}
.cb-chip__dot[data-kind="wildcard"]     { background: var(--wp-kind-wildcard, #c026d3); }
.cb-chip__dot[data-kind="fixed_values"] { background: var(--wp-kind-fixed, #0ea5e9); }
.cb-chip__dot[data-kind="combine"]      { background: var(--wp-kind-combine, #f59e0b); }
.cb-chip__icon {
  font-size: 11px;
  opacity: 0.85;
}

/* Preview card -------------------------------------------------------- */
.cb-preview {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cb-preview__row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 12px;
  align-items: baseline;
  font-size: 13px;
  line-height: 1.5;
}
.cb-preview__label {
  font-size: 10px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--wp-text3, #6e6e7c);
}
.cb-preview__value {
  color: var(--wp-text);
  word-break: break-word;
}
.cb-preview__sample {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--wp-text2);
}
</style>
