<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import type { ModuleEntry } from "../../widgets/_shared";

const props = defineProps<{
  visible: boolean;
  module: ModuleEntry | null;
  /** Variable names defined upstream — used for autocomplete + validity checks. */
  upstreamVars?: string[];
  /** Variable names defined by OTHER modules in the same node. */
  siblingVars?: string[];
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
    if (draft.value && draft.value.entries.length > 0) {
      firstNameInput.value?.focus();
      firstNameInput.value?.select();
    } else {
      moduleNameInput.value?.focus();
      moduleNameInput.value?.select();
    }
    window.addEventListener("keydown", onKeydown);
  } else {
    window.removeEventListener("keydown", onKeydown);
    draft.value = null;
  }
});

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
  return "pi-question";
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
  emit("save", JSON.parse(JSON.stringify(draft.value)));
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
</script>

<template>
  <ModalShell :visible="visible" @close="cancel">
    <div v-if="draft" class="wp-medit">
      <header class="wp-medit__head">
        <i :class="['pi', iconFor(draft.type), 'wp-medit__head-icon', `type-${draft.type}`]" aria-hidden="true"></i>
        <input
          ref="moduleNameInput"
          v-model="draft.meta.name"
          class="wp-medit__name-input"
          placeholder="module name"
          spellcheck="false"
        />
        <button type="button" class="wp-medit__close" aria-label="Close" @click="cancel">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </header>

      <div class="wp-medit__body">
        <section class="wp-medit__section">
          <label class="wp-medit__section-label">DESCRIPTION</label>
          <input
            v-model="draft.meta.description"
            class="wp-medit__meta-input"
            placeholder="optional — what this module is for"
          />
        </section>

        <section class="wp-medit__section">
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
</style>
