<script setup lang="ts">
import { computed, ref } from "vue";
import { varColorClass } from "../../shared/var-color";
import type { ModuleEntry } from "../../../widgets/_shared";

type DerivationOp = "equals" | "not_equals" | "contains" | "matches";
type DerivationMode = "replace" | "append" | "prepend";

const OP_OPTIONS: Array<{ label: string; value: DerivationOp }> = [
  { label: "equals", value: "equals" },
  { label: "not equals", value: "not_equals" },
  { label: "contains", value: "contains" },
  { label: "matches (regex)", value: "matches" },
];
const MODE_OPTIONS: Array<{ label: string; value: DerivationMode }> = [
  { label: "replace", value: "replace" },
  { label: "append", value: "append" },
  { label: "prepend", value: "prepend" },
];

interface DerivationCondition { var: string; op: DerivationOp; value: string }
interface DerivationAction { target_var: string; mode: DerivationMode; value: string }
interface DerivationBranch { condition: DerivationCondition; action: DerivationAction }
interface DerivationElse { action: DerivationAction }
interface DerivationRule { id: string; branches: DerivationBranch[]; else?: DerivationElse }

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ (e: "update", patch: Partial<ModuleEntry>): void }>();

// ── Derived from module ───────────────────────────────────────────────────────

const moduleAsRecord = computed(() => props.module as unknown as Record<string, unknown>);

const meta = computed<{ name?: string; description?: string; tags?: string[] }>(
  () => (moduleAsRecord.value.meta as Record<string, unknown>) ?? {},
);

const payload = computed<{ rules?: DerivationRule[] }>(
  () => (moduleAsRecord.value.payload as Record<string, unknown>) ?? {},
);

const rules = computed<DerivationRule[]>(() =>
  Array.isArray(payload.value.rules) ? (payload.value.rules as DerivationRule[]) : [],
);
const description = computed(() => meta.value.description ?? "");
const tags = computed<string[]>(() =>
  Array.isArray(meta.value.tags) ? (meta.value.tags as string[]) : [],
);
const categoryId = computed(
  () => (moduleAsRecord.value.category_id as string | null | undefined) ?? "",
);

const tagDraft = ref("");
const collapsed = ref<Set<string>>(new Set());

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

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

function blankCondition(): DerivationCondition { return { var: "", op: "equals", value: "" }; }
function blankAction(): DerivationAction { return { target_var: "", mode: "replace", value: "" }; }
function blankBranch(): DerivationBranch { return { condition: blankCondition(), action: blankAction() }; }

// ── Rule mutation helpers ─────────────────────────────────────────────────────

function addRule(): void {
  patchPayload({ rules: [...rules.value, { id: newId(), branches: [blankBranch()] }] });
}

function removeRule(i: number): void {
  const next = rules.value.slice();
  next.splice(i, 1);
  patchPayload({ rules: next });
}

function patchRule(i: number, p: Partial<DerivationRule>): void {
  const next = rules.value.slice();
  next[i] = { ...next[i], ...p };
  patchPayload({ rules: next });
}

function addElif(ri: number): void {
  patchRule(ri, { branches: [...rules.value[ri].branches, blankBranch()] });
}

function removeBranch(ri: number, bi: number): void {
  if (bi === 0) return; // can't remove the IF branch
  const next = rules.value[ri].branches.slice();
  next.splice(bi, 1);
  patchRule(ri, { branches: next });
}

function addElse(ri: number): void {
  patchRule(ri, { else: { action: blankAction() } });
}

function removeElse(ri: number): void {
  const r = { ...rules.value[ri] };
  delete r.else;
  const next = rules.value.slice();
  next[ri] = r;
  patchPayload({ rules: next });
}

function setCondition(ri: number, bi: number, field: keyof DerivationCondition, value: string): void {
  const branches = rules.value[ri].branches.slice();
  branches[bi] = { ...branches[bi], condition: { ...branches[bi].condition, [field]: value } };
  patchRule(ri, { branches });
}

function setAction(ri: number, bi: number, field: keyof DerivationAction, value: string): void {
  const branches = rules.value[ri].branches.slice();
  branches[bi] = { ...branches[bi], action: { ...branches[bi].action, [field]: value } };
  patchRule(ri, { branches });
}

function setElse(ri: number, field: keyof DerivationAction, value: string): void {
  const cur = rules.value[ri].else?.action ?? blankAction();
  patchRule(ri, { else: { action: { ...cur, [field]: value } } });
}

// ── Collapse toggle ───────────────────────────────────────────────────────────

function toggleCollapsed(id: string): void {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

function isCollapsed(id: string): boolean { return collapsed.value.has(id); }

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
            data-test="dv-name"
            @input="patchMeta({ name: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="wp-field">
          <span class="wp-field-label">Category</span>
          <input
            class="wp-input"
            :value="categoryId"
            placeholder="None"
            data-test="dv-category"
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
          data-test="dv-description"
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
            data-test="dv-tag-input"
            @keydown.enter.prevent="addTag"
          />
          <button type="button" class="wp-btn" @click="addTag">
            <i class="pi pi-plus" /> Add
          </button>
        </div>
        <div v-if="tags.length" class="wp-tags-list" data-test="dv-tags">
          <span v-for="t in tags" :key="t" class="wp-pill on">
            {{ t
            }}<button type="button" @click="removeTag(t)"><i class="pi pi-times" /></button>
          </span>
        </div>
      </div>
    </section>

    <!-- Rules ───────────────────────────────────────────────────────────── -->
    <section class="wp-edit-section">
      <div class="wp-edit-section-title">
        Rules
        <small class="wp-edit-section-meta">{{ rules.length }} entr{{ rules.length === 1 ? "y" : "ies" }}</small>
        <button
          type="button"
          class="wp-btn wp-btn--primary"
          data-test="dv-add-rule"
          @click="addRule"
        >
          <i class="pi pi-plus" /> Add rule
        </button>
      </div>
      <p class="wp-edit-section-hint">
        Each rule runs independently. Branches evaluate top-to-bottom — first matching
        <code>IF</code>/<code>ELIF</code> wins; <code>ELSE</code> only fires when no branch matched.
      </p>

      <div v-if="!rules.length" class="wp-empty-row" data-test="dv-rules-empty">
        No rules yet. Click <strong>Add rule</strong> to start.
      </div>

      <div v-else class="wp-rule-stack" data-test="dv-rules-stack">
        <div
          v-for="(rule, ri) in rules"
          :key="rule.id"
          class="wp-rule-card"
          :data-test="`dv-rule-${ri}`"
        >
          <!-- Rule header -->
          <div
            role="button"
            tabindex="0"
            class="wp-rule-head"
            :aria-expanded="!isCollapsed(rule.id)"
            :data-test="`dv-toggle-rule-${ri}`"
            @click="toggleCollapsed(rule.id)"
            @keydown.enter.prevent="toggleCollapsed(rule.id)"
            @keydown.space.prevent="toggleCollapsed(rule.id)"
          >
            <i :class="isCollapsed(rule.id) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" />
            <span class="wp-rule-chip">Rule {{ ri + 1 }}</span>
            <span class="wp-rule-meta">
              {{ rule.branches.length }} branch{{ rule.branches.length === 1 ? "" : "es" }}
              <template v-if="rule.else"> + ELSE</template>
            </span>
            <span class="wp-rule-spacer" />
            <button
              type="button"
              class="wp-btn wp-btn--icon-sm wp-btn--danger"
              :data-test="`dv-remove-rule-${ri}`"
              :aria-label="`Remove rule ${ri + 1}`"
              @click.stop="removeRule(ri)"
            >
              <i class="pi pi-trash" />
            </button>
          </div>

          <!-- Rule body (branches) -->
          <div v-show="!isCollapsed(rule.id)" class="wp-rule-body">
            <div
              v-for="(branch, bi) in rule.branches"
              :key="bi"
              class="wp-branch"
              :data-kind="bi === 0 ? 'if' : 'elif'"
              :data-test="`dv-branch-${ri}-${bi}`"
            >
              <div class="wp-branch-head">
                <span class="wp-branch-tag" :data-kind="bi === 0 ? 'if' : 'elif'">
                  {{ bi === 0 ? "IF" : "ELIF" }}
                </span>
                <span class="wp-rule-spacer" />
                <button
                  v-if="bi > 0"
                  type="button"
                  class="wp-btn wp-btn--icon-sm wp-btn--danger"
                  :data-test="`dv-remove-elif-${ri}-${bi}`"
                  :aria-label="`Remove ELIF branch ${bi} from rule ${ri + 1}`"
                  @click="removeBranch(ri, bi)"
                >
                  <i class="pi pi-times" />
                </button>
              </div>

              <!-- When (condition) -->
              <div class="wp-branch-row">
                <span class="wp-branch-row-label">When</span>
                <input
                  class="wp-input wp-input--mono"
                  :value="branch.condition.var"
                  placeholder="$variable"
                  :aria-label="`Condition variable for rule ${ri + 1} branch ${bi + 1}`"
                  @input="setCondition(ri, bi, 'var', ($event.target as HTMLInputElement).value)"
                />
                <select
                  class="wp-input wp-branch-op"
                  :value="branch.condition.op"
                  :aria-label="`Condition operator for rule ${ri + 1} branch ${bi + 1}`"
                  @change="setCondition(ri, bi, 'op', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="o in OP_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <input
                  class="wp-input wp-input--mono"
                  :value="branch.condition.value"
                  placeholder="value"
                  :aria-label="`Condition value for rule ${ri + 1} branch ${bi + 1}`"
                  @input="setCondition(ri, bi, 'value', ($event.target as HTMLInputElement).value)"
                />
              </div>

              <!-- Then (action target + mode) -->
              <div class="wp-branch-row">
                <span class="wp-branch-row-label">Then</span>
                <input
                  class="wp-input wp-input--mono"
                  :class="varColorClass(branch.action.target_var)"
                  :value="branch.action.target_var"
                  placeholder="target_var"
                  :aria-label="`Action target for rule ${ri + 1} branch ${bi + 1}`"
                  @input="setAction(ri, bi, 'target_var', ($event.target as HTMLInputElement).value)"
                />
                <select
                  class="wp-input wp-branch-op"
                  :value="branch.action.mode"
                  :aria-label="`Action mode for rule ${ri + 1} branch ${bi + 1}`"
                  @change="setAction(ri, bi, 'mode', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="m in MODE_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
                </select>
              </div>

              <!-- Value (action value) -->
              <div class="wp-branch-row wp-branch-row--value">
                <span class="wp-branch-row-label">Value</span>
                <input
                  class="wp-input wp-input--mono wp-branch-value-full"
                  :value="branch.action.value"
                  :aria-label="`Action value for rule ${ri + 1} branch ${bi + 1}`"
                  @input="setAction(ri, bi, 'value', ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>

            <!-- ELSE branch -->
            <div
              v-if="rule.else"
              class="wp-branch"
              data-kind="else"
              :data-test="`dv-branch-else-${ri}`"
            >
              <div class="wp-branch-head">
                <span class="wp-branch-tag" data-kind="else">ELSE</span>
                <span class="wp-rule-spacer" />
                <button
                  type="button"
                  class="wp-btn wp-btn--icon-sm wp-btn--danger"
                  :data-test="`dv-remove-else-${ri}`"
                  :aria-label="`Remove ELSE from rule ${ri + 1}`"
                  @click="removeElse(ri)"
                >
                  <i class="pi pi-times" />
                </button>
              </div>
              <div class="wp-branch-row">
                <span class="wp-branch-row-label">Then</span>
                <input
                  class="wp-input wp-input--mono"
                  :class="varColorClass(rule.else.action.target_var)"
                  :value="rule.else.action.target_var"
                  placeholder="target_var"
                  :aria-label="`ELSE action target for rule ${ri + 1}`"
                  @input="setElse(ri, 'target_var', ($event.target as HTMLInputElement).value)"
                />
                <select
                  class="wp-input wp-branch-op"
                  :value="rule.else.action.mode"
                  :aria-label="`ELSE action mode for rule ${ri + 1}`"
                  @change="setElse(ri, 'mode', ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="m in MODE_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
                </select>
              </div>
              <div class="wp-branch-row wp-branch-row--value">
                <span class="wp-branch-row-label">Value</span>
                <input
                  class="wp-input wp-input--mono wp-branch-value-full"
                  :value="rule.else.action.value"
                  :aria-label="`ELSE action value for rule ${ri + 1}`"
                  @input="setElse(ri, 'value', ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>

            <!-- Add ELIF / Add ELSE actions -->
            <div class="wp-rule-actions">
              <button
                type="button"
                class="wp-btn"
                :data-test="`dv-add-elif-${ri}`"
                @click="addElif(ri)"
              >
                <i class="pi pi-plus" /> Add ELIF
              </button>
              <button
                v-if="!rule.else"
                type="button"
                class="wp-btn"
                :data-test="`dv-add-else-${ri}`"
                @click="addElse(ri)"
              >
                <i class="pi pi-plus" /> Add ELSE
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ── Derivation-specific ─────────────────────────────────────────────────── */
.wp-edit-section-hint {
  font: 11px/1.4 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  margin: 0 0 8px;
}

.wp-rule-stack { display: flex; flex-direction: column; gap: 8px; }

.wp-rule-card {
  background: var(--wp-bg-deep, var(--wp-bg2));
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--wp-kind-derivation, #fbbf24);
  border-radius: var(--wp-radius);
  padding: 8px;
}

.wp-rule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0;
  cursor: pointer;
  user-select: none;
}
.wp-rule-head .pi { font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); }

.wp-rule-chip {
  font: 600 9px/1 var(--wp-font-sans);
  color: var(--wp-kind-derivation, #fbbf24);
  background: color-mix(in srgb, var(--wp-kind-derivation, #fbbf24) 22%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 6px;
  border-radius: 2px;
}

.wp-rule-meta { font: 11px/1 var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-rule-spacer { flex: 1; }

.wp-rule-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 8px;
  border-left: 2px solid color-mix(in srgb, var(--wp-kind-derivation, #fbbf24) 30%, transparent);
}

.wp-rule-actions { display: flex; gap: 4px; margin-top: 4px; }

.wp-branch {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: var(--wp-radius);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-branch[data-kind="if"] { border-left: 3px solid var(--wp-kind-derivation, #fbbf24); }
.wp-branch[data-kind="elif"] { border-left: 3px solid var(--wp-info, #60a5fa); }
.wp-branch[data-kind="else"] { border-left: 3px solid var(--wp-warn, #f59e0b); border-style: dashed; border-left-style: solid; }

.wp-branch-head { display: flex; align-items: center; gap: 6px; }

.wp-branch-tag {
  font: 700 9px/1 var(--wp-font-mono);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 2px;
}
.wp-branch-tag[data-kind="if"] {
  background: color-mix(in srgb, var(--wp-kind-derivation, #fbbf24) 22%, transparent);
  color: var(--wp-kind-derivation, #fbbf24);
}
.wp-branch-tag[data-kind="elif"] {
  background: color-mix(in srgb, var(--wp-info, #60a5fa) 22%, transparent);
  color: var(--wp-info, #60a5fa);
}
.wp-branch-tag[data-kind="else"] {
  background: color-mix(in srgb, var(--wp-warn, #f59e0b) 22%, transparent);
  color: var(--wp-warn, #f59e0b);
}

.wp-branch-row {
  display: grid;
  grid-template-columns: 44px 1fr 110px 1fr;
  gap: 4px;
  align-items: center;
}
.wp-branch-row--value {
  grid-template-columns: 44px 1fr;
}
.wp-branch-row-label {
  font: 500 10px/1 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-branch-op { font-family: var(--wp-font-mono); padding: 6px 4px; }
.wp-branch-value-full { grid-column: 2 / -1; }

/* ── Shared editor CSS (verbatim from CombineEditorBody.vue) ─────────────── */
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
</style>
