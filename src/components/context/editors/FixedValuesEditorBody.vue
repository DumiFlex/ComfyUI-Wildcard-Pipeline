<script setup lang="ts">
import { computed, ref } from "vue";
import { varColorClass } from "../../shared/var-color";
import type { ModuleEntry } from "../../../widgets/_shared";

interface FixedValue { id: string; name: string; value: string }

const props = defineProps<{
  module: ModuleEntry;
}>();

const emit = defineEmits<{
  (e: "update", patch: Partial<ModuleEntry>): void;
}>();

// ── Derived from payload ──────────────────────────────────────────────────────

const values = computed<FixedValue[]>(() => {
  const v = (props.module.payload as { values?: FixedValue[] } | undefined)?.values;
  return Array.isArray(v) ? v : [];
});

// Treat module as Record for the category_id field that lives outside ModuleEntry.
const categoryId = computed<string>(() => {
  const m = props.module as unknown as Record<string, unknown>;
  const val = m["category_id"];
  return typeof val === "string" ? val : "";
});

// meta fields
const description = computed<string>(
  () => (props.module.meta as { description?: string }).description ?? "",
);
const tags = computed<string[]>(() => {
  const t = (props.module.meta as { tags?: string[] }).tags;
  return Array.isArray(t) ? t : [];
});

// ── Local draft state ─────────────────────────────────────────────────────────

const tagDraft = ref("");

// ── Helpers ───────────────────────────────────────────────────────────────────

function patchMeta(p: Partial<{ name: string; description: string; tags: string[] }>): void {
  emit("update", { meta: { ...props.module.meta, ...p } } as Partial<ModuleEntry>);
}

function patchPayload(p: Record<string, unknown>): void {
  emit("update", {
    payload: { ...(props.module.payload ?? {}), ...p },
  } as Partial<ModuleEntry>);
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

// ── Values ────────────────────────────────────────────────────────────────────

function addValue(): void {
  const newVal: FixedValue = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10),
    name: "",
    value: "",
  };
  patchPayload({ values: [...values.value, newVal] });
}

function removeValue(i: number): void {
  const next = values.value.slice();
  next.splice(i, 1);
  patchPayload({ values: next });
}

function setValue(i: number, field: keyof FixedValue, v: string): void {
  const next = values.value.slice();
  next[i] = { ...next[i], [field]: v };
  patchPayload({ values: next });
}

function onVarNameInput(i: number, v: string): void {
  // Strip leading $ and any non-identifier chars
  const cleaned = v.replace(/^\$+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  setValue(i, "name", cleaned);
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
            :value="module.meta.name"
            data-test="fv-name"
            @input="patchMeta({ name: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="wp-field">
          <span class="wp-field-label">Category</span>
          <input
            class="wp-input"
            :value="categoryId"
            placeholder="None"
            data-test="fv-category"
            @input="
              emit('update', {
                category_id: ($event.target as HTMLInputElement).value || null,
              } as Partial<ModuleEntry>)
            "
          />
        </label>
      </div>

      <label class="wp-field">
        <span class="wp-field-label">Description</span>
        <textarea
          class="wp-input"
          rows="2"
          :value="description"
          data-test="fv-description"
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
            data-test="fv-tag-input"
            @keydown.enter.prevent="addTag"
          />
          <button type="button" class="wp-btn" @click="addTag">
            <i class="pi pi-plus" /> Add
          </button>
        </div>
        <div v-if="tags.length" class="wp-tags-list" data-test="fv-tags">
          <span v-for="t in tags" :key="t" class="wp-pill on">
            {{ t
            }}<button type="button" @click="removeTag(t)"><i class="pi pi-times" /></button>
          </span>
        </div>
      </div>
    </section>

    <!-- Values ──────────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Values
        <small class="wp-edit-section-meta">{{ values.length }} entries</small>
        <button
          type="button"
          class="wp-btn wp-btn--primary"
          data-test="fv-add-value"
          @click="addValue"
        >
          <i class="pi pi-plus" /> Add value
        </button>
      </div>
      <table class="wp-options-table" data-test="fv-values-table">
        <thead>
          <tr>
            <th style="width: 200px;">Variable</th>
            <th>Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(v, i) in values" :key="v.id">
            <td>
              <div class="wp-input-group">
                <span class="wp-input-group__addon">$</span>
                <input
                  class="wp-input wp-input--mono"
                  :class="varColorClass(v.name)"
                  :value="v.name"
                  placeholder="varname"
                  aria-label="Variable name"
                  @input="onVarNameInput(i, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </td>
            <td>
              <textarea
                class="wp-input wp-input--mono"
                rows="1"
                :value="v.value"
                aria-label="Variable value"
                @input="setValue(i, 'value', ($event.target as HTMLTextAreaElement).value)"
              />
            </td>
            <td>
              <button
                type="button"
                class="wp-btn wp-btn--icon-sm wp-btn--danger"
                aria-label="Remove value"
                @click="removeValue(i)"
              >
                <i class="pi pi-trash" />
              </button>
            </td>
          </tr>
          <tr v-if="!values.length">
            <td colspan="3" class="wp-empty-row">No values yet.</td>
          </tr>
        </tbody>
      </table>
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

.wp-options-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--wp-bg-deep, var(--wp-bg2));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  overflow: hidden;
  font: 11px/1.4 var(--wp-font-sans);
}
.wp-options-table thead tr {
  background: var(--wp-bg3);
}
.wp-options-table th {
  padding: 6px 8px;
  text-align: left;
  font: 600 10px/1 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-options-table td {
  padding: 4px 6px;
  border-top: 1px solid var(--wp-border);
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
</style>
