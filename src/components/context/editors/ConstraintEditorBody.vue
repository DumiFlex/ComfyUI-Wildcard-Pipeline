<script setup lang="ts">
import { computed, ref } from "vue";
import type { ModuleEntry } from "../../../widgets/_shared";

type ConstraintMode = "allow" | "exclude" | "boost" | "reduce";
const MODE_OPTIONS: ConstraintMode[] = ["allow", "exclude", "boost", "reduce"];
const MODE_CYCLE: Record<ConstraintMode, ConstraintMode> = {
  allow: "exclude",
  exclude: "boost",
  boost: "reduce",
  reduce: "allow",
};

interface ConstraintCell { mode: ConstraintMode; factor: number }
interface ConstraintException { source: string; target: string; mode: ConstraintMode; factor: number }
interface ConstraintMatrixShape { [sourceSubCat: string]: { [targetSubCat: string]: ConstraintCell } }

const props = defineProps<{
  module: ModuleEntry;
  /**
   * Other modules in the same WP_Context — used to look up source/target
   * wildcards' sub_categories so we can populate the matrix axes.
   * Phase A: best-effort; matrix renders empty hint when not available.
   */
  siblingModules?: ModuleEntry[];
}>();
const emit = defineEmits<{ (e: "update", patch: Partial<ModuleEntry>): void }>();

// ── Derived from module ───────────────────────────────────────────────────────

const moduleAsRecord = computed(() => props.module as unknown as Record<string, unknown>);

const meta = computed<{ name?: string; description?: string; tags?: string[] }>(
  () => (moduleAsRecord.value.meta as Record<string, unknown>) ?? {},
);

const payload = computed<{
  source_wildcard_id?: string | null;
  target_wildcard_id?: string | null;
  matrix?: ConstraintMatrixShape;
  exceptions?: ConstraintException[];
}>(() => (moduleAsRecord.value.payload as Record<string, unknown>) ?? {});

const description = computed(() => meta.value.description ?? "");
const tags = computed<string[]>(() =>
  Array.isArray(meta.value.tags) ? (meta.value.tags as string[]) : [],
);
const categoryId = computed(
  () => (moduleAsRecord.value.category_id as string | null | undefined) ?? "",
);

const sourceId = computed(() => payload.value.source_wildcard_id ?? "");
const targetId = computed(() => payload.value.target_wildcard_id ?? "");
const matrix = computed<ConstraintMatrixShape>(() =>
  payload.value.matrix && typeof payload.value.matrix === "object"
    ? (payload.value.matrix as ConstraintMatrixShape)
    : {},
);
const exceptions = computed<ConstraintException[]>(() =>
  Array.isArray(payload.value.exceptions) ? (payload.value.exceptions as ConstraintException[]) : [],
);

const tagDraft = ref("");

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

// ── Sub-category lookup ───────────────────────────────────────────────────────

function findWildcard(id: string): { sub_categories?: string[] } | null {
  if (!id) return null;
  const m = (props.siblingModules ?? []).find((x) => x.id === id);
  if (!m || m.type !== "wildcard") return null;
  return (m.payload ?? {}) as { sub_categories?: string[] };
}

const sourceSubs = computed<string[]>(() => {
  const wc = findWildcard(sourceId.value);
  return Array.isArray(wc?.sub_categories) ? (wc?.sub_categories as string[]) : [];
});

const targetSubs = computed<string[]>(() => {
  const wc = findWildcard(targetId.value);
  return Array.isArray(wc?.sub_categories) ? (wc?.sub_categories as string[]) : [];
});

// ── Matrix helpers ────────────────────────────────────────────────────────────

function getCell(srcSub: string, tgtSub: string): ConstraintCell {
  return matrix.value?.[srcSub]?.[tgtSub] ?? { mode: "allow", factor: 1 };
}

function setCell(srcSub: string, tgtSub: string, cell: ConstraintCell): void {
  const next: ConstraintMatrixShape = { ...matrix.value };
  next[srcSub] = { ...(next[srcSub] ?? {}), [tgtSub]: cell };
  patchPayload({ matrix: next });
}

function cycleCell(srcSub: string, tgtSub: string): void {
  const cur = getCell(srcSub, tgtSub);
  setCell(srcSub, tgtSub, { ...cur, mode: MODE_CYCLE[cur.mode] });
}

function tuneCell(srcSub: string, tgtSub: string): void {
  const cur = getCell(srcSub, tgtSub);
  // Phase A simplification: native prompt for factor edit. SPA uses a popover.
  const input = window.prompt(
    `Factor for "${srcSub}" → "${tgtSub}" (current ${cur.factor}). Used by boost/reduce modes.`,
    String(cur.factor),
  );
  if (input === null) return;
  const next = Number(input);
  if (!Number.isFinite(next) || next < 0) return;
  setCell(srcSub, tgtSub, { ...cur, factor: next });
}

// ── Exception helpers ─────────────────────────────────────────────────────────

function addException(): void {
  patchPayload({
    exceptions: [...exceptions.value, { source: "", target: "", mode: "allow", factor: 1 }],
  });
}

function removeException(i: number): void {
  const next = exceptions.value.slice();
  next.splice(i, 1);
  patchPayload({ exceptions: next });
}

function setException(
  i: number,
  field: keyof ConstraintException,
  value: string | number,
): void {
  const next = exceptions.value.slice();
  next[i] = { ...next[i], [field]: value };
  patchPayload({ exceptions: next });
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
            data-test="cn-name"
            @input="patchMeta({ name: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="wp-field">
          <span class="wp-field-label">Category</span>
          <input
            class="wp-input"
            :value="categoryId"
            placeholder="None"
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
            @keydown.enter.prevent="addTag"
          />
          <button type="button" class="wp-btn" @click="addTag">
            <i class="pi pi-plus" /> Add
          </button>
        </div>
        <div v-if="tags.length" class="wp-tags-list">
          <span v-for="t in tags" :key="t" class="wp-pill on">
            {{ t
            }}<button type="button" @click="removeTag(t)"><i class="pi pi-times" /></button>
          </span>
        </div>
      </div>
    </section>

    <!-- Wildcards pair — SOURCE FIRST ───────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Wildcards
        <small class="wp-edit-section-meta">
          pick the two wildcards whose sub-categories form the matrix
        </small>
      </div>
      <div class="wp-cn-pair">
        <label class="wp-field">
          <span class="wp-field-label">
            Source wildcard
            <small class="wp-field-hint">rows of the matrix</small>
          </span>
          <input
            class="wp-input wp-input--mono"
            :value="sourceId"
            placeholder="source uuid"
            data-test="cn-source"
            @input="
              patchPayload({
                source_wildcard_id: ($event.target as HTMLInputElement).value || null,
                matrix: {},
              })
            "
          />
        </label>
        <div class="wp-cn-cross"><i class="pi pi-times" /></div>
        <label class="wp-field">
          <span class="wp-field-label">
            Target wildcard
            <small class="wp-field-hint">columns of the matrix</small>
          </span>
          <input
            class="wp-input wp-input--mono"
            :value="targetId"
            placeholder="target uuid"
            data-test="cn-target"
            @input="
              patchPayload({
                target_wildcard_id: ($event.target as HTMLInputElement).value || null,
                matrix: {},
              })
            "
          />
        </label>
      </div>
    </section>

    <!-- Rule matrix ─────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Rule matrix
        <small class="wp-edit-section-meta">
          click cycles mode · cog tunes factor
        </small>
      </div>
      <div v-if="!sourceId || !targetId" class="wp-empty-row" data-test="cn-matrix-empty">
        Pick a source and target wildcard to populate the matrix.
      </div>
      <div
        v-else-if="!sourceSubs.length || !targetSubs.length"
        class="wp-empty-row"
        data-test="cn-matrix-need-subs"
      >
        <i class="pi pi-info-circle" style="margin-right: 4px" />
        <span v-if="!sourceSubs.length">Source wildcard needs at least one sub-category. </span>
        <span v-if="!targetSubs.length">Target wildcard needs at least one sub-category. </span>
        Add them on the wildcard editor to define rules.
      </div>
      <table v-else class="wp-cmx" data-test="cn-matrix">
        <thead>
          <tr>
            <th class="wp-cmx-axis">source ↓ / target →</th>
            <th v-for="t in targetSubs" :key="t">{{ t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sourceSubs" :key="s">
            <th class="wp-cmx-axis">{{ s }}</th>
            <td v-for="t in targetSubs" :key="t">
              <div
                class="wp-cmx-cell"
                :data-mode="getCell(s, t).mode"
                :title="`${getCell(s, t).mode} (factor ${getCell(s, t).factor})`"
              >
                <button
                  type="button"
                  class="wp-cmx-mode-btn"
                  :data-test="`cn-cell-mode-${s}-${t}`"
                  @click="cycleCell(s, t)"
                >
                  {{ getCell(s, t).mode
                  }}<template
                    v-if="getCell(s, t).mode === 'boost' || getCell(s, t).mode === 'reduce'"
                  >
                    ×{{ getCell(s, t).factor }}</template
                  >
                </button>
                <button
                  type="button"
                  class="wp-cmx-cog"
                  :title="`Tune factor (current ${getCell(s, t).factor})`"
                  :data-test="`cn-cell-cog-${s}-${t}`"
                  @click.stop="tuneCell(s, t)"
                >
                  <i class="pi pi-cog" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Exceptions ──────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Exceptions
        <small class="wp-edit-section-meta">
          {{ exceptions.length }} entr{{ exceptions.length === 1 ? "y" : "ies" }} · per-value
          override (beats matrix)
        </small>
        <button
          type="button"
          class="wp-btn wp-btn--primary"
          data-test="cn-add-exception"
          @click="addException"
        >
          <i class="pi pi-plus" /> Add exception
        </button>
      </div>
      <table
        v-if="exceptions.length"
        class="wp-options-table"
        data-test="cn-exceptions"
      >
        <thead>
          <tr>
            <th>Source value</th>
            <th>Target value</th>
            <th style="width: 110px">Mode</th>
            <th style="width: 70px">Factor</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(ex, i) in exceptions" :key="i">
            <td>
              <input
                class="wp-input wp-input--mono"
                :value="ex.source"
                placeholder="source value"
                @input="setException(i, 'source', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <input
                class="wp-input wp-input--mono"
                :value="ex.target"
                placeholder="target value"
                @input="setException(i, 'target', ($event.target as HTMLInputElement).value)"
              />
            </td>
            <td>
              <select
                class="wp-input"
                :value="ex.mode"
                :aria-label="`Exception mode ${i + 1}`"
                @change="
                  setException(i, 'mode', ($event.target as HTMLSelectElement).value)
                "
              >
                <option v-for="m in MODE_OPTIONS" :key="m" :value="m">{{ m }}</option>
              </select>
            </td>
            <td>
              <input
                class="wp-input wp-input--mono"
                type="number"
                :value="ex.factor"
                :aria-label="`Exception factor ${i + 1}`"
                @input="
                  setException(
                    i,
                    'factor',
                    Number(($event.target as HTMLInputElement).value) || 1,
                  )
                "
              />
            </td>
            <td>
              <button
                type="button"
                class="wp-btn wp-btn--icon-sm wp-btn--danger"
                aria-label="Remove exception"
                @click="removeException(i)"
              >
                <i class="pi pi-trash" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="wp-empty-row">No exceptions yet.</div>
    </section>
  </div>
</template>

<style scoped>
/* ── Constraint-specific ─────────────────────────────────────────────────── */
.wp-cn-pair {
  display: grid;
  grid-template-columns: 1fr 32px 1fr;
  gap: 8px;
  align-items: end;
}
.wp-cn-cross {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  color: var(--wp-text-dim, var(--wp-text3));
}

.wp-field-hint {
  display: inline;
  font: 400 10px/1 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-left: 4px;
  text-transform: none;
  letter-spacing: 0;
}

.wp-cmx {
  width: 100%;
  border-collapse: collapse;
  background: var(--wp-bg-deep, var(--wp-bg2));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  overflow: hidden;
}
.wp-cmx th,
.wp-cmx td {
  padding: 4px 6px;
  font: 11px/1.3 var(--wp-font-sans);
  border: 1px solid var(--wp-border);
}
.wp-cmx thead tr {
  background: var(--wp-bg3);
}
.wp-cmx th {
  text-align: center;
  color: var(--wp-text-muted, var(--wp-text3));
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-cmx-axis {
  font-family: var(--wp-font-mono);
  text-transform: none;
  letter-spacing: 0;
  color: var(--wp-accent-text, var(--wp-text));
  background: var(--wp-bg3);
}

.wp-cmx-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 2px 4px;
  border-radius: 2px;
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-cmx-cell[data-mode="allow"] {
  background: color-mix(in srgb, var(--wp-success, #6bc96f) 22%, transparent);
  color: var(--wp-success, #6bc96f);
}
.wp-cmx-cell[data-mode="exclude"] {
  background: color-mix(in srgb, var(--wp-danger, #e05252) 22%, transparent);
  color: var(--wp-danger, #e05252);
}
.wp-cmx-cell[data-mode="boost"] {
  background: color-mix(in srgb, var(--wp-accent) 22%, transparent);
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-cmx-cell[data-mode="reduce"] {
  background: color-mix(in srgb, var(--wp-warn, #f59e0b) 22%, transparent);
  color: var(--wp-warn, #f59e0b);
}

.wp-cmx-mode-btn {
  flex: 1 1 auto;
  background: transparent;
  border: 0;
  padding: 2px 2px;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  text-align: center;
}
.wp-cmx-cog {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 2px;
  cursor: pointer;
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 10px;
  line-height: 1;
  border-radius: 2px;
  opacity: 0.55;
}
.wp-cmx-cog:hover,
.wp-cmx-cog:focus-visible {
  opacity: 1;
  outline: none;
}

/* ── Options table (exceptions) ──────────────────────────────────────────── */
.wp-options-table {
  width: 100%;
  border-collapse: collapse;
  font: 11px/1.3 var(--wp-font-sans);
}
.wp-options-table th,
.wp-options-table td {
  padding: 4px 6px;
  border: 1px solid var(--wp-border);
  vertical-align: middle;
}
.wp-options-table thead tr {
  background: var(--wp-bg3);
}
.wp-options-table th {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--wp-text-muted, var(--wp-text3));
}
.wp-options-table tbody tr:nth-child(even) {
  background: var(--wp-bg-deep, var(--wp-bg2));
}

/* ── Shared editor CSS (verbatim from DerivationEditorBody.vue) ──────────── */
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
  border-color: color-mix(
    in srgb,
    var(--wp-danger, #e05252) 40%,
    var(--wp-border-soft, var(--wp-border))
  );
}
.wp-btn .pi {
  font-size: 11px;
}
</style>
