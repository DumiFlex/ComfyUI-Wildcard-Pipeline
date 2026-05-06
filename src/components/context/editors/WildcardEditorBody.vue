<script setup lang="ts">
import { computed, ref } from "vue";
import { varColorClass } from "../../shared/var-color";
import type { ModuleEntry } from "../../../widgets/_shared";

interface WildcardOption {
  id: string;
  weight: number;
  value: string;
  sub_category?: string | null;
}

const props = defineProps<{
  module: ModuleEntry;
  // pass-through props from shell — keep optional, don't make them required
  upstreamVars?: string[];
  siblingVars?: string[];
  siblingModules?: ModuleEntry[];
  lastUsedSeedReader?: (moduleId?: string) => number | null;
}>();

const emit = defineEmits<{
  (e: "update", patch: Partial<ModuleEntry>): void;
}>();

// ── Derived from payload ──────────────────────────────────────────────────────

const subCategories = computed<string[]>(() => {
  const sc = (props.module.payload as { sub_categories?: string[] } | undefined)
    ?.sub_categories;
  return Array.isArray(sc) ? sc : [];
});

const options = computed<WildcardOption[]>(() => {
  const o = (props.module.payload as { options?: WildcardOption[] } | undefined)?.options;
  return Array.isArray(o) ? o : [];
});

const varBinding = computed<string>(() => {
  const p = props.module.payload as { var_binding?: string } | undefined;
  return p?.var_binding ?? "";
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

const subDraft = ref("");
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

function probability(i: number): number {
  const total = options.value.reduce((a, o) => a + (Number(o.weight) || 0), 0);
  if (!total) return 0;
  return ((Number(options.value[i].weight) || 0) / total) * 100;
}

// ── Sub-categories ────────────────────────────────────────────────────────────

function addSub(): void {
  const v = subDraft.value.trim();
  if (!v || subCategories.value.includes(v)) {
    subDraft.value = "";
    return;
  }
  patchPayload({ sub_categories: [...subCategories.value, v] });
  subDraft.value = "";
}

function removeSub(s: string): void {
  patchPayload({
    sub_categories: subCategories.value.filter((x) => x !== s),
    options: options.value.map((o) =>
      o.sub_category === s ? { ...o, sub_category: null } : o,
    ),
  });
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

// ── Options ───────────────────────────────────────────────────────────────────

function addOption(): void {
  const newOpt: WildcardOption = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10),
    weight: 1,
    value: "",
    sub_category: null,
  };
  patchPayload({ options: [...options.value, newOpt] });
}

function removeOption(i: number): void {
  const next = options.value.slice();
  next.splice(i, 1);
  patchPayload({ options: next });
}

function setOption(
  i: number,
  field: keyof WildcardOption,
  value: WildcardOption[keyof WildcardOption],
): void {
  const next = options.value.slice();
  next[i] = { ...next[i], [field]: value };
  patchPayload({ options: next });
}

// ── Var binding ───────────────────────────────────────────────────────────────

function onVarBindingInput(v: string): void {
  const cleaned = v.replace(/^\$+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  patchPayload({ var_binding: cleaned });
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
            data-test="wc-name"
            @input="patchMeta({ name: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="wp-field">
          <span class="wp-field-label">Category</span>
          <!-- Phase A: plain text input. Real Select + categoryStore is post-MVP. -->
          <input
            class="wp-input"
            :value="categoryId"
            placeholder="None"
            data-test="wc-category"
            @input="
              emit('update', {
                category_id: ($event.target as HTMLInputElement).value || null,
              } as Partial<ModuleEntry>)
            "
          />
        </label>
      </div>

      <label class="wp-field">
        <span class="wp-field-label">Variable name</span>
        <div class="wp-input-group">
          <span class="wp-input-group__addon">$</span>
          <input
            class="wp-input wp-input--mono"
            :class="varColorClass(varBinding)"
            :value="varBinding"
            placeholder="hair_style"
            data-test="wc-var-binding"
            @input="onVarBindingInput(($event.target as HTMLInputElement).value)"
          />
        </div>
      </label>

      <label class="wp-field">
        <span class="wp-field-label">Description</span>
        <textarea
          class="wp-input"
          rows="2"
          :value="description"
          data-test="wc-description"
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
            data-test="wc-tag-input"
            @keydown.enter.prevent="addTag"
          />
          <button type="button" class="wp-btn" @click="addTag">
            <i class="pi pi-plus" /> Add
          </button>
        </div>
        <div v-if="tags.length" class="wp-tags-list" data-test="wc-tags">
          <span v-for="t in tags" :key="t" class="wp-pill on">
            {{ t
            }}<button type="button" @click="removeTag(t)"><i class="pi pi-times" /></button>
          </span>
        </div>
      </div>
    </section>

    <!-- Sub-Categories ──────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">Sub-Categories</div>
      <div class="wp-tags-input">
        <input
          v-model="subDraft"
          class="wp-input"
          placeholder="e.g. warm tones"
          data-test="wc-sub-input"
          @keydown.enter.prevent="addSub"
        />
        <button type="button" class="wp-btn" @click="addSub">
          <i class="pi pi-plus" /> Add
        </button>
      </div>
      <div v-if="subCategories.length" class="wp-tags-list" data-test="wc-subs">
        <span v-for="s in subCategories" :key="s" class="wp-pill on">
          {{ s
          }}<button type="button" @click="removeSub(s)"><i class="pi pi-times" /></button>
        </span>
      </div>
    </section>

    <!-- Options ─────────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Options
        <small class="wp-edit-section-meta">{{ options.length }} entries</small>
        <button
          type="button"
          class="wp-btn wp-btn--primary"
          data-test="wc-add-option"
          @click="addOption"
        >
          <i class="pi pi-plus" /> Add option
        </button>
      </div>
      <table class="wp-options-table" data-test="wc-options-table">
        <thead>
          <tr>
            <th>Weight</th>
            <th>Value</th>
            <th>Sub-category</th>
            <th>Probability</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(o, i) in options" :key="o.id">
            <td>
              <input
                class="wp-input wp-input--mono"
                type="number"
                aria-label="Option weight"
                :value="o.weight"
                @input="
                  setOption(
                    i,
                    'weight',
                    Number(($event.target as HTMLInputElement).value) || 0,
                  )
                "
              />
            </td>
            <td>
              <input
                class="wp-input wp-input--mono"
                aria-label="Option value"
                :value="o.value"
                @input="setOption(i, 'value', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <select
                class="wp-input"
                aria-label="Sub-category for option"
                :value="o.sub_category ?? ''"
                @change="
                  setOption(
                    i,
                    'sub_category',
                    ($event.target as HTMLSelectElement).value || null,
                  )
                "
              >
                <option value="">(none)</option>
                <option v-for="s in subCategories" :key="s" :value="s">{{ s }}</option>
              </select>
            </td>
            <td>
              <div class="wp-prob">
                <div class="wp-prob-bar">
                  <div class="wp-prob-fill" :style="{ width: probability(i) + '%' }" />
                </div>
                <span class="wp-prob-pct">{{ probability(i).toFixed(0) }}%</span>
              </div>
            </td>
            <td>
              <button
                type="button"
                class="wp-btn wp-btn--icon-sm wp-btn--danger"
                @click="removeOption(i)"
              >
                <i class="pi pi-trash" />
              </button>
            </td>
          </tr>
          <tr v-if="!options.length">
            <td colspan="5" class="wp-empty-row">No options yet.</td>
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

.wp-prob {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-prob-bar {
  flex: 1;
  height: 6px;
  background: var(--wp-bg3);
  border-radius: 3px;
  overflow: hidden;
}
.wp-prob-fill {
  height: 100%;
  background: var(--wp-accent);
}
.wp-prob-pct {
  font: 600 10px/1 var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text3));
  min-width: 28px;
  text-align: right;
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
