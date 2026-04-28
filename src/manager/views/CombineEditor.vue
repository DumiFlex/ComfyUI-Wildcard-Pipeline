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
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Chip from "../components/ui/Chip.vue";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import { tokenizeRich } from "../utils/richTokenize";
import { useToast } from "../composables/useToast";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import { buildUuidToName } from "../utils/wildcardSyntax";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  CombinePayload,
  ModuleHistoryEntry,
  WildcardPayload,
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
const outputVarTouched = ref(false);
const outputVarError = ref("");
const saving = ref(false);
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);

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

interface VarHint { label: string; kind: "wildcard" | "fixed_values" | "combine" }
const varHints = computed<VarHint[]>(() => {
  const seen = new Set<string>();
  const out: VarHint[] = [];
  for (const m of moduleStore.items) {
    if (props.id && m.id === props.id) continue;
    if (m.type === "wildcard") {
      const p = (m.payload ?? {}) as Partial<WildcardPayload>;
      const b = (p.var_binding && p.var_binding.trim()) || toIdentifier(m.name);
      if (b && !seen.has(b)) { seen.add(b); out.push({ label: b, kind: "wildcard" }); }
    } else if (m.type === "fixed_values") {
      const values = ((m.payload ?? {}) as { values?: { name?: string }[] }).values ?? [];
      for (const row of values) {
        const n = (row.name ?? "").replace(/^\$+/, "").trim();
        if (n && !seen.has(n)) { seen.add(n); out.push({ label: n, kind: "fixed_values" }); }
      }
    } else if (m.type === "combine") {
      const p = (m.payload ?? {}) as Partial<CombinePayload>;
      const o = (p.output_var ?? "").replace(/^\$+/, "").trim();
      if (o && !seen.has(o)) { seen.add(o); out.push({ label: o, kind: "combine" }); }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
});

const varSuggestions = computed<string[]>(() => varHints.value.map((h) => h.label));
// Surfaces `@{uuid}` chips with human var-names in template + preview.
// Combine surface ignores `@` refs at resolve time, but stray UUIDs
// pasted in still benefit from the labelled chip.
const uuidToName = computed(() => buildUuidToName(moduleStore.items));
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
      historyEntries.value = readHistory(row.payload);
    } catch {
      toast.push({ severity: "error", summary: "Combine not found" });
      router.replace("/combines");
    }
  }
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
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    router.push("/combines");
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push("/combines"); }
</script>

<template>
  <EditorFrame
    :title="isEdit ? 'Edit combine' : 'New combine'"
    back-route="/combines"
    back-label="Combines"
    :saving="saving"
    :history-entries="historyEntries"
    @save="save"
    @cancel="cancel"
    @restore="applyRestore"
  >
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
  </EditorFrame>
</template>

<style scoped>
.cb-grid {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 12px;
}
.cb-detected {
  margin-top: 12px;
}
.cb-detected__label { margin-bottom: 6px; }
.cb-detected__hint { font-size: 12px; }
.cb-detected__chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.cb-detected__warn { color: var(--wp-warn); margin-left: 4px; }
.cb-preview__row {
  margin-top: 4px;
  margin-bottom: 8px;
}
</style>
