<script setup lang="ts">
/**
 * WildcardFilesPanel — what a wildcard file conversion produced, shown
 * above the import picker. Lists the files read (untick one to leave it
 * out, e.g. an older copy of the same pack), the library tag and category
 * to file the wildcards under, and the conversion notes: anything that
 * could not be carried over exactly, with examples.
 *
 * Presentational: the host (ImportTab) owns the uploaded files and
 * re-runs the conversion on `apply`.
 */
import { computed, ref, watch } from "vue";
import {
  describeNote,
  noteNeedsAttention,
  type WildcardFilesReport,
  type WildcardImportOptions,
} from "./wildcard-files";

interface Props {
  report: WildcardFilesReport;
  options: WildcardImportOptions;
  busy?: boolean;
}
const props = withDefaults(defineProps<Props>(), { busy: false });

const emit = defineEmits<{
  (e: "apply", options: WildcardImportOptions): void;
}>();

const packTag = ref(props.options.packTag ?? "");
const category = ref(props.options.category ?? "");
const bundles = ref(props.options.bundles !== false);
const packName = ref(props.options.packName ?? "");
const excluded = ref<Set<string>>(new Set(props.options.exclude ?? []));

watch(() => props.options, (o) => {
  packTag.value = o.packTag ?? "";
  category.value = o.category ?? "";
  bundles.value = o.bundles !== false;
  packName.value = o.packName ?? "";
  excluded.value = new Set(o.exclude ?? []);
});

const dirty = computed(() => {
  const o = props.options;
  const before = new Set(o.exclude ?? []);
  if ((o.packTag ?? "") !== packTag.value.trim()) return true;
  if ((o.category ?? "") !== category.value.trim()) return true;
  if ((o.bundles !== false) !== bundles.value) return true;
  if ((o.packName ?? "") !== packName.value.trim()) return true;
  if (before.size !== excluded.value.size) return true;
  for (const p of excluded.value) if (!before.has(p)) return true;
  return false;
});

const readFiles = computed(() => props.report.files.filter((f) => f.status === "ok").length);

const notes = computed(() => [...props.report.notes].sort((a, b) =>
  Number(noteNeedsAttention(b.kind)) - Number(noteNeedsAttention(a.kind)) || b.count - a.count,
));

const openNote = ref<string | null>(null);
const filesOpen = ref(props.report.files.length <= 12);

function toggleFile(path: string): void {
  const next = new Set(excluded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  excluded.value = next;
}

function apply(): void {
  emit("apply", {
    packTag: packTag.value.trim(),
    category: category.value.trim(),
    bundles: bundles.value,
    packName: packName.value.trim(),
    exclude: [...excluded.value],
  });
}

function fileStatus(f: WildcardFilesReport["files"][number]): string {
  if (f.status === "excluded") return "left out";
  if (f.status === "error") return f.error ?? "could not be read";
  if (f.status === "empty") return "no wildcards";
  const n = `${f.wildcards} ${f.wildcards === 1 ? "wildcard" : "wildcards"}`;
  return f.duplicates ? `${n}, ${f.duplicates} already defined by another file` : n;
}
</script>

<template>
  <section class="wp-wcf" data-test="wildcard-files-panel" :aria-busy="props.busy">
    <header class="wp-wcf__summary">
      <i class="pi pi-file-import wp-wcf__icon" aria-hidden="true" />
      <p class="wp-wcf__summary-text" data-test="wildcard-files-summary">
        <strong>{{ props.report.wildcards }}</strong>
        {{ props.report.wildcards === 1 ? "wildcard" : "wildcards" }}
        <template v-if="props.report.groups">
          + <strong>{{ props.report.groups }}</strong>
          {{ props.report.groups === 1 ? "group" : "groups" }}
        </template>
        with {{ props.report.options.toLocaleString() }} options from
        {{ readFiles }} {{ readFiles === 1 ? "file" : "files" }}<template v-if="props.report.bundles">,
          filed into <strong>{{ props.report.bundles }}</strong>
          {{ props.report.bundles === 1 ? "bundle" : "bundles" }}</template>.
        Pick what to import below.
      </p>
    </header>

    <div class="wp-wcf__fields">
      <label class="wp-wcf__field">
        <span class="wp-wcf__label">Library tag</span>
        <input
          v-model="packTag"
          class="wp-wcf__input"
          placeholder="none"
          data-test="wildcard-files-tag"
        />
      </label>
      <label class="wp-wcf__field">
        <span class="wp-wcf__label">Category</span>
        <input
          v-model="category"
          class="wp-wcf__input"
          placeholder="one per top folder"
          data-test="wildcard-files-category"
        />
      </label>
      <div class="wp-wcf__field">
        <label class="wp-wcf__label">
          <input v-model="bundles" type="checkbox" data-test="wildcard-files-bundles" />
          Bundle name
        </label>
        <input
          v-model="packName"
          class="wp-wcf__input"
          :disabled="!bundles"
          placeholder="Imported wildcards"
          aria-label="Bundle name"
          data-test="wildcard-files-pack-name"
        />
      </div>
      <button
        type="button"
        class="wp-wcf__btn wp-wcf__btn--primary"
        :disabled="!dirty || props.busy"
        data-test="wildcard-files-apply"
        @click="apply"
      >{{ props.busy ? "Converting…" : "Apply" }}</button>
    </div>

    <div class="wp-wcf__block">
      <button
        type="button"
        class="wp-wcf__toggle"
        :aria-expanded="filesOpen"
        data-test="wildcard-files-files-toggle"
        @click="filesOpen = !filesOpen"
      >
        <i :class="['pi', filesOpen ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" />
        Files ({{ props.report.files.length }})
      </button>
      <ul v-if="filesOpen" class="wp-wcf__files" data-test="wildcard-files-files">
        <li
          v-for="f in props.report.files"
          :key="f.path"
          class="wp-wcf__file"
          :class="{
            'wp-wcf__file--error': f.status === 'error',
            'wp-wcf__file--off': excluded.has(f.path),
            'wp-wcf__file--dup': !!f.duplicates,
          }"
        >
          <label class="wp-wcf__file-label">
            <input
              type="checkbox"
              :checked="!excluded.has(f.path)"
              :disabled="f.status === 'error'"
              @change="toggleFile(f.path)"
            />
            <span class="wp-wcf__file-path">{{ f.path }}</span>
          </label>
          <span class="wp-wcf__file-status">{{ fileStatus(f) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="notes.length" class="wp-wcf__block" data-test="wildcard-files-notes">
      <p class="wp-wcf__notes-head">Conversion notes</p>
      <ul class="wp-wcf__notes">
        <li v-for="n in notes" :key="n.kind" class="wp-wcf__note">
          <button
            type="button"
            class="wp-wcf__note-row"
            :aria-expanded="openNote === n.kind"
            @click="openNote = openNote === n.kind ? null : n.kind"
          >
            <i
              :class="['pi', noteNeedsAttention(n.kind) ? 'pi-exclamation-triangle wp-wcf__warn' : 'pi-info-circle wp-wcf__info']"
              aria-hidden="true"
            />
            <span class="wp-wcf__note-text">{{ describeNote(n.kind) }}</span>
            <span class="wp-wcf__note-count">{{ n.count }}</span>
          </button>
          <ul v-if="openNote === n.kind" class="wp-wcf__examples">
            <li v-for="(ex, i) in n.examples" :key="i">
              <span class="wp-wcf__ex-name">{{ ex.wildcard }}</span>
              <code class="wp-wcf__ex-detail">{{ ex.detail }}</code>
            </li>
            <li v-if="n.count > n.examples.length" class="wp-wcf__ex-more">
              and {{ n.count - n.examples.length }} more
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.wp-wcf {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  padding: var(--wp-space-5) var(--wp-space-6);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-sm);
}
.wp-wcf[aria-busy="true"] { opacity: 0.6; }
.wp-wcf__summary { display: flex; align-items: flex-start; gap: var(--wp-space-4); }
.wp-wcf__icon { color: var(--wp-accent); font-size: var(--wp-text-md); margin-top: 2px; }
.wp-wcf__summary-text { margin: 0; color: var(--wp-text); }
.wp-wcf__fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--wp-space-5); }
.wp-wcf__field { display: flex; flex-direction: column; gap: var(--wp-space-2); min-width: 180px; flex: 1; }
.wp-wcf__label {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  font-size: var(--wp-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-muted);
  font-weight: var(--wp-weight-semibold);
}
.wp-wcf__input {
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-4);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font: inherit;
}
.wp-wcf__input:disabled { opacity: 0.5; }
.wp-wcf__input:focus-visible { outline: none; border-color: var(--wp-accent-500); box-shadow: var(--wp-focus-ring); }
.wp-wcf__btn {
  height: var(--wp-btn-h);
  padding: 0 var(--wp-space-6);
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-3);
  color: var(--wp-text);
  font: inherit;
  font-weight: var(--wp-weight-medium);
  cursor: pointer;
}
.wp-wcf__btn--primary {
  background: linear-gradient(180deg, var(--wp-accent-500), var(--wp-accent-600));
  border-color: var(--wp-accent-600);
  /* audit-exempt: white on saturated accent-500/600 gradient ≥4.5:1 both themes */
  color: #fff;
}
.wp-wcf__btn:disabled { opacity: 0.45; cursor: default; }
.wp-wcf__block { display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-wcf__toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 0;
  background: none;
  border: 0;
  color: var(--wp-text-muted);
  font: inherit;
  font-weight: var(--wp-weight-semibold);
  cursor: pointer;
}
.wp-wcf__files, .wp-wcf__notes, .wp-wcf__examples { list-style: none; margin: 0; padding: 0; }
.wp-wcf__files {
  max-height: 240px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-1);
}
.wp-wcf__file {
  display: flex;
  justify-content: space-between;
  gap: var(--wp-space-5);
  padding: var(--wp-space-2) var(--wp-space-4);
  border-bottom: 1px solid var(--wp-border);
}
.wp-wcf__file:last-child { border-bottom: 0; }
.wp-wcf__file-label { display: flex; align-items: center; gap: var(--wp-space-3); min-width: 0; }
.wp-wcf__file-path { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); overflow-wrap: anywhere; }
.wp-wcf__file-status { color: var(--wp-text-muted); font-size: var(--wp-text-xs); text-align: right; flex-shrink: 0; max-width: 50%; }
.wp-wcf__file--off .wp-wcf__file-path { color: var(--wp-text-dim); text-decoration: line-through; }
.wp-wcf__file--error .wp-wcf__file-status { color: var(--wp-danger); }
.wp-wcf__file--dup .wp-wcf__file-status { color: var(--wp-warn); }
.wp-wcf__notes-head { margin: 0; color: var(--wp-text-muted); font-weight: var(--wp-weight-semibold); }
.wp-wcf__note-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-2) 0;
  background: none;
  border: 0;
  color: var(--wp-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wp-wcf__note-text { flex: 1; }
.wp-wcf__note-count {
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
.wp-wcf__warn { color: var(--wp-warn); }
.wp-wcf__info { color: var(--wp-text-dim); }
.wp-wcf__examples {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  margin: 0 0 var(--wp-space-3) var(--wp-space-7, 24px);
}
.wp-wcf__examples li { display: flex; gap: var(--wp-space-4); min-width: 0; }
.wp-wcf__ex-name { color: var(--wp-text-muted); flex-shrink: 0; }
.wp-wcf__ex-detail {
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
  overflow-wrap: anywhere;
  color: var(--wp-text);
}
.wp-wcf__ex-more { color: var(--wp-text-dim); }
</style>
