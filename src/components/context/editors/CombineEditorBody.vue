<script setup lang="ts">
import { computed, ref } from "vue";
import { varColorClass } from "../../shared/var-color";
import type { ModuleEntry } from "../../../widgets/_shared";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ (e: "update", patch: Partial<ModuleEntry>): void }>();

// ── Derived from module ───────────────────────────────────────────────────────

const moduleAsRecord = computed(() => props.module as unknown as Record<string, unknown>);

const meta = computed<{ name?: string; description?: string; tags?: string[] }>(
  () => (moduleAsRecord.value.meta as Record<string, unknown>) ?? {},
);

const payload = computed<{ template?: string; output_var?: string }>(
  () => (moduleAsRecord.value.payload as Record<string, unknown>) ?? {},
);

const description = computed(() => meta.value.description ?? "");
const tags = computed<string[]>(() =>
  Array.isArray(meta.value.tags) ? (meta.value.tags as string[]) : [],
);
const categoryId = computed(
  () => (moduleAsRecord.value.category_id as string | null | undefined) ?? "",
);
const template = computed(() => payload.value.template ?? "");
const outputVar = computed(() => (payload.value.output_var ?? "").replace(/^\$+/, ""));

const tagDraft = ref("");

// Detected $var refs in the template — same regex AssemblerHelper uses.
const TEMPLATE_VAR_RE = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;
const detectedInputs = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of (template.value ?? "").matchAll(TEMPLATE_VAR_RE)) {
    const name = m[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
});

// Preview tokens for the template — splits on $var so each var ref can be
// painted with its own var-color hash. Mirrors AssemblerHelper's tokeniser.
interface PreviewToken { kind: "literal" | "var"; text: string; varName?: string }
const previewTokens = computed<PreviewToken[]>(() => {
  const tpl = template.value ?? "";
  if (!tpl) return [];
  const tokens: PreviewToken[] = [];
  let last = 0;
  for (const m of tpl.matchAll(TEMPLATE_VAR_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ kind: "literal", text: tpl.slice(last, idx) });
    tokens.push({ kind: "var", text: `$${m[1]}`, varName: m[1] });
    last = idx + m[0].length;
  }
  if (last < tpl.length) tokens.push({ kind: "literal", text: tpl.slice(last) });
  return tokens;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function patch(p: Record<string, unknown>): void {
  emit("update", p as Partial<ModuleEntry>);
}

function patchMeta(p: Record<string, unknown>): void {
  emit("update", { meta: { ...meta.value, ...p } } as unknown as Partial<ModuleEntry>);
}

function patchPayload(p: Record<string, unknown>): void {
  emit("update", {
    payload: { ...(props.module.payload ?? {}), ...p },
  } as Partial<ModuleEntry>);
}

function onOutputVarInput(v: string): void {
  const cleaned = v.replace(/^\$+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  patchPayload({ output_var: cleaned });
}

// ── Tags ──────────────────────────────────────────────────────────────────────

function addTag(): void {
  const v = tagDraft.value.trim();
  if (!v || tags.value.includes(v)) {
    tagDraft.value = "";
    return;
  }
  patchMeta({ tags: [...tags.value, v] });
  tagDraft.value = "";
}

function removeTag(t: string): void {
  patchMeta({ tags: tags.value.filter((x) => x !== t) });
}
</script>

<template>
  <div class="wp-edit-body">
    <!-- Identity ────────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">Identity</div>

      <div class="wp-field-row">
        <label class="wp-field">
          <span class="wp-field-label">Name</span>
          <input
            class="wp-input"
            :value="meta.name ?? ''"
            data-test="cb-name"
            @input="patchMeta({ name: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="wp-field">
          <span class="wp-field-label">Category</span>
          <input
            class="wp-input"
            :value="categoryId"
            placeholder="None"
            data-test="cb-category"
            @input="patch({ category_id: ($event.target as HTMLInputElement).value || null })"
          />
        </label>
      </div>

      <label class="wp-field">
        <span class="wp-field-label">Description</span>
        <textarea
          class="wp-input"
          rows="2"
          :value="description"
          data-test="cb-description"
          @input="patchMeta({ description: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <div class="wp-field">
        <span class="wp-field-label">Tags</span>
        <div class="wp-tags-input">
          <input
            v-model="tagDraft"
            class="wp-input"
            placeholder="Type a tag and press Enter…"
            data-test="cb-tag-input"
            @keydown.enter.prevent="addTag"
          />
          <button type="button" class="wp-btn" @click="addTag">
            <i class="pi pi-plus" /> Add
          </button>
        </div>
        <div v-if="tags.length" class="wp-tags-list" data-test="cb-tags">
          <span v-for="t in tags" :key="t" class="wp-pill on">
            {{ t
            }}<button type="button" @click="removeTag(t)"><i class="pi pi-times" /></button>
          </span>
        </div>
      </div>
    </section>

    <!-- Template & Output ───────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">Template &amp; Output</div>

      <label class="wp-field">
        <span class="wp-field-label">
          Template
          <small class="wp-field-hint">$name refs · $$ for literal $ · {a|b|c} inline choice</small>
        </span>
        <textarea
          class="wp-input wp-input--mono"
          rows="3"
          :value="template"
          placeholder="$first_name, a $age-year-old with $hair_color hair"
          data-test="cb-template"
          @input="patchPayload({ template: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label class="wp-field">
        <span class="wp-field-label">
          Output variable
          <small class="wp-field-hint">downstream modules read this name</small>
        </span>
        <div class="wp-input-group">
          <span class="wp-input-group__addon">$</span>
          <input
            class="wp-input wp-input--mono"
            :class="varColorClass(outputVar)"
            :value="outputVar"
            placeholder="subject_phrase"
            data-test="cb-output-var"
            @input="onOutputVarInput(($event.target as HTMLInputElement).value)"
          />
        </div>
      </label>
    </section>

    <!-- Detected inputs ─────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Detected inputs
        <small class="wp-edit-section-meta">{{ detectedInputs.length }} — auto-extracted from template</small>
      </div>
      <div v-if="detectedInputs.length" class="wp-tags-list" data-test="cb-detected">
        <span
          v-for="v in detectedInputs"
          :key="v"
          class="wp-pill"
          :class="varColorClass(v)"
        >
          <i class="pi pi-tag" style="font-size: 9px; opacity: 0.7;" />
          <span class="wp-input--mono">{{ v }}</span>
        </span>
      </div>
      <div v-else class="wp-empty-row">None — type a template above.</div>
    </section>

    <!-- Preview ─────────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">Preview</div>
      <div class="wp-cb-preview" data-test="cb-preview">
        <div v-if="previewTokens.length" class="wp-cb-preview-template">
          <template v-for="(tok, i) in previewTokens" :key="i">
            <span v-if="tok.kind === 'literal'" class="wp-cb-preview-lit">{{ tok.text }}</span>
            <span
              v-else
              :class="['wp-cb-preview-var', varColorClass(tok.varName ?? '')]"
            >{{ tok.text }}</span>
          </template>
        </div>
        <div v-else class="wp-cb-preview-empty">(template empty)</div>
        <div class="wp-cb-preview-output">
          <span style="color: var(--wp-text-dim);">→ stored as </span>
          <span :class="['wp-input--mono', varColorClass(outputVar)]" style="font-weight: 600;">${{ outputVar || "output" }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wp-edit-body {
  padding: 14px 16px;
  max-height: 520px;
  overflow-y: auto;
}
.wp-edit-section {
  margin-bottom: 16px;
}
.wp-edit-section-title {
  font: 600 10px/1 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--wp-border);
  display: flex;
  align-items: center;
  gap: 8px;
}
.wp-edit-section-meta {
  font: 400 11px/1 var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: none;
  letter-spacing: 0;
  margin-left: auto;
}
.wp-edit-section-title .wp-btn {
  margin-left: auto;
  padding: 3px 8px;
}
.wp-edit-section-meta + .wp-btn {
  margin-left: 0;
}

.wp-field {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
}
.wp-field-label {
  display: block;
  font: 500 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
  margin-bottom: 4px;
}
.wp-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.wp-input {
  background: var(--wp-bg-deep, var(--wp-bg2));
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  color: var(--wp-text);
  font: 12px/1 var(--wp-font-sans);
  padding: 6px 8px;
  border-radius: var(--wp-radius);
  width: 100%;
  box-sizing: border-box;
}
.wp-input:focus {
  outline: 0;
  border-color: var(--wp-accent);
  box-shadow: 0 0 0 1px var(--wp-accent);
}
.wp-input--mono {
  font-family: var(--wp-font-mono);
}
.wp-input-group {
  display: flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg2));
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: var(--wp-radius);
  overflow: hidden;
}
.wp-input-group__addon {
  padding: 6px 8px;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 12px/1 var(--wp-font-mono);
  border-right: 1px solid var(--wp-border-soft, var(--wp-border));
  background: var(--wp-bg3);
}
.wp-input-group .wp-input {
  background: transparent;
  border: 0;
}

.wp-tags-input {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.wp-tags-input .wp-input {
  flex: 1;
}
.wp-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wp-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: 999px;
  font: 500 11px/1 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
}
.wp-pill.on {
  background: color-mix(in srgb, var(--wp-accent) 22%, var(--wp-bg3));
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-pill button {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
}
.wp-pill .pi {
  font-size: 9px;
  opacity: 0.7;
}

.wp-empty-row {
  padding: 16px;
  text-align: center;
  color: var(--wp-text-dim, var(--wp-text3));
  font-style: italic;
}

.wp-btn {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  color: var(--wp-text);
  font: 500 11px/1 var(--wp-font-sans);
  padding: 5px 9px;
  border-radius: var(--wp-radius);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.wp-btn:hover {
  background: var(--wp-bg2);
}
.wp-btn--primary {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
}
.wp-btn--primary:hover {
  background: var(--wp-accent2, var(--wp-accent));
  border-color: var(--wp-accent2, var(--wp-accent));
}
.wp-btn--icon-sm {
  padding: 3px;
  width: 22px;
  height: 22px;
  justify-content: center;
  background: transparent;
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-btn--icon-sm:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-border-soft, var(--wp-border));
  color: var(--wp-text);
}
.wp-btn--danger:hover {
  color: var(--wp-danger, #e05252);
  border-color: color-mix(in srgb, var(--wp-danger, #e05252) 40%, var(--wp-border-soft, var(--wp-border)));
}
.wp-btn .pi {
  font-size: 11px;
}

/* Combine-specific extras */
.wp-field-hint {
  font: 400 11px/1 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: none;
  letter-spacing: 0;
  margin-left: 4px;
}
.wp-cb-preview {
  background: var(--wp-bg-deep, var(--wp-bg2));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 8px 10px;
  font: 12px/1.55 var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text3));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-cb-preview-template {
  white-space: pre-wrap;
  word-break: break-word;
}
.wp-cb-preview-lit { color: var(--wp-text); }
.wp-cb-preview-var {
  font-weight: 600;
}
.wp-cb-preview-empty { color: var(--wp-text-dim); font-style: italic; }
.wp-cb-preview-output {
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
  padding-top: 6px;
  font-size: 11px;
}
</style>
