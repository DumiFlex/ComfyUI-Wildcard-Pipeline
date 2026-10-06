<script setup lang="ts">
/**
 * PackConverter — the "Wildcard packs" tab of Import / Export.
 *
 * Turns a Dynamic Prompts / Prompt-PostProcessor / Impact Pack folder,
 * zip or loose files into Wildcard Pipeline modules in three steps:
 *
 *   1. Load    drop zone; the server converts (engine/wildcard_files.py).
 *   2. Review  the conversion plan: every wildcard with its role in the
 *              pack (entry point / composition / vocabulary / group) and
 *              how faithfully it came across, by domain (top folder),
 *              plus the import settings, the files read and the notes.
 *   3. Import  emits `payload-ready`; the host shows the normal picker,
 *              conflict modal and commit, and this tab folds into a bar.
 *
 * The host (ImportExport) owns the import pipeline. `incoming` hands over
 * a pack dropped on the plain Import tab.
 */
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import { parsePayload, type IntegrityWarning } from "./parse";
import type { RawPayload } from "./migrations";
import {
  buildWildcardForm,
  describeNote,
  FIDELITY_LABEL,
  filterPlan,
  noteNeedsAttention,
  PLAN_FIDELITIES,
  PLAN_ROLES,
  ROLE_HINT,
  ROLE_LABEL,
  sourcesFromDrop,
  sourcesFromFileList,
  suggestPackName,
  suggestPackTag,
  summarizePlan,
  WILDCARD_FILE_ACCEPT,
  type PlanFidelity,
  type PlanItem,
  type PlanRole,
  type WildcardFilesReport,
  type WildcardImportOptions,
  type WildcardSource,
} from "./wildcard-files";

interface Props {
  /** True once the host accepted the payload and shows the picker. */
  payloadLoaded?: boolean;
  /** A pack dropped elsewhere (the Import tab) to convert right away. */
  incoming?: WildcardSource[] | null;
}
const props = withDefaults(defineProps<Props>(), { payloadLoaded: false, incoming: null });

const emit = defineEmits<{
  (
    e: "payload-ready",
    payload: RawPayload,
    migratedCount: number,
    integrityWarnings: IntegrityWarning[],
  ): void;
  /** Back from the picker to the review (the host clears its picker). */
  (e: "back"): void;
}>();

// ---------- Step 1: load ----------
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const sources = ref<WildcardSource[]>([]);
const options = ref<WildcardImportOptions>({});
const report = ref<WildcardFilesReport | null>(null);
const payload = ref<RawPayload | null>(null);
const busy = ref(false);
const errorMsg = ref("");
const dragging = ref(false);

async function convert(next: WildcardSource[], opts: WildcardImportOptions): Promise<void> {
  if (next.length === 0) {
    errorMsg.value = "No wildcard files found (.txt, .yaml, .yml, .json or a .zip of them).";
    return;
  }
  busy.value = true;
  errorMsg.value = "";
  try {
    const result = await api.importExport.wildcardFiles(buildWildcardForm(next, opts));
    sources.value = next;
    options.value = opts;
    report.value = result.report;
    payload.value = result.payload;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function start(next: WildcardSource[]): Promise<void> {
  resetFilters();
  return convert(next, {
    packTag: suggestPackTag(next),
    packName: suggestPackName(next),
    bundles: true,
  });
}

async function onPick(ev: Event): Promise<void> {
  const target = ev.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  target.value = "";
  if (files.length > 0) await start(sourcesFromFileList(files));
}

function onDragOver(ev: DragEvent): void {
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  dragging.value = true;
}

function onDragLeave(ev: DragEvent): void {
  const zone = ev.currentTarget as HTMLElement;
  const to = ev.relatedTarget as Node | null;
  if (to && zone.contains(to)) return;
  dragging.value = false;
}

async function onDrop(ev: DragEvent): Promise<void> {
  ev.preventDefault();
  dragging.value = false;
  if (!ev.dataTransfer) return;
  // Folder entries must be read during the drop event, before any await.
  await start(await sourcesFromDrop(ev.dataTransfer));
}

function startOver(): void {
  sources.value = [];
  report.value = null;
  payload.value = null;
  options.value = {};
  errorMsg.value = "";
  resetFilters();
  if (props.payloadLoaded) emit("back");
}

// ---------- Step 2: review ----------
const plan = computed<PlanItem[]>(() => report.value?.plan ?? []);
const summary = computed(() => summarizePlan(plan.value));

const domain = ref<string | null>(null);
const roles = ref<Set<PlanRole>>(new Set());
const fidelities = ref<Set<PlanFidelity>>(new Set());
const query = ref("");
const shown = ref(PAGE);
const openRow = ref<string | null>(null);

function resetFilters(): void {
  domain.value = null;
  roles.value = new Set();
  fidelities.value = new Set();
  query.value = "";
  shown.value = PAGE;
  openRow.value = null;
}

const rows = computed(() => filterPlan(plan.value, {
  domain: domain.value,
  roles: roles.value,
  fidelities: fidelities.value,
  query: query.value,
}));
const visibleRows = computed(() => rows.value.slice(0, shown.value));

watch([domain, roles, fidelities, query], () => { shown.value = PAGE; });

function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function toggleRole(role: PlanRole): void {
  roles.value = toggleIn(roles.value, role);
}

function toggleFidelity(f: PlanFidelity): void {
  fidelities.value = toggleIn(fidelities.value, f);
}

function share(n: number): string {
  const total = plan.value.length || 1;
  return `${Math.max(n > 0 ? 2 : 0, (n / total) * 100)}%`;
}

function domainLabel(name: string): string {
  return name === "" ? "Loose files" : name;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// Settings: edited locally, applied by re-running the conversion.
const packName = ref("");
const packTag = ref("");
const category = ref("");
const bundles = ref(true);
const excluded = ref<Set<string>>(new Set());

watch(options, (o) => {
  packName.value = o.packName ?? "";
  packTag.value = o.packTag ?? "";
  category.value = o.category ?? "";
  bundles.value = o.bundles !== false;
  excluded.value = new Set(o.exclude ?? []);
}, { immediate: true });

const dirty = computed(() => {
  const o = options.value;
  const before = new Set(o.exclude ?? []);
  if ((o.packName ?? "") !== packName.value.trim()) return true;
  if ((o.packTag ?? "") !== packTag.value.trim()) return true;
  if ((o.category ?? "") !== category.value.trim()) return true;
  if ((o.bundles !== false) !== bundles.value) return true;
  if (before.size !== excluded.value.size) return true;
  for (const p of excluded.value) if (!before.has(p)) return true;
  return false;
});

function apply(): void {
  void convert(sources.value, {
    packName: packName.value.trim(),
    packTag: packTag.value.trim(),
    category: category.value.trim(),
    bundles: bundles.value,
    exclude: [...excluded.value],
  });
}

function toggleFile(path: string): void {
  excluded.value = toggleIn(excluded.value, path);
}

const filesOpen = ref(false);
const readFiles = computed(() => report.value?.files.filter((f) => f.status === "ok").length ?? 0);
const problemFiles = computed(() =>
  report.value?.files.filter((f) => f.status === "error" || f.duplicates).length ?? 0);

function fileStatus(f: WildcardFilesReport["files"][number]): string {
  if (f.status === "excluded") return "left out";
  if (f.status === "error") return f.error ?? "could not be read";
  if (f.status === "empty") return "no wildcards";
  const n = plural(f.wildcards, "wildcard", "wildcards");
  return f.duplicates ? `${n}, ${f.duplicates} already defined by another file` : n;
}

const notes = computed(() => [...(report.value?.notes ?? [])].sort((a, b) =>
  Number(noteNeedsAttention(b.kind)) - Number(noteNeedsAttention(a.kind)) || b.count - a.count));
const openNote = ref<string | null>(null);

const bundleLine = computed(() => {
  const r = report.value;
  if (!r) return "";
  if (!bundles.value) return "No bundles: everything goes to the library.";
  if (r.bundles === 0) return "No entry points, so no bundles: the lists go to the library.";
  return `${plural(summary.value.roles.entry, "entry point", "entry points")} in ${plural(r.bundles, "bundle", "bundles")}.`;
});

// ---------- Step 3: hand off to the picker ----------
const step = computed<1 | 2 | 3>(() => (props.payloadLoaded ? 3 : report.value ? 2 : 1));

function continueToImport(): void {
  if (!payload.value) return;
  const parsed = parsePayload(JSON.stringify(payload.value));
  if (!parsed.ok) {
    errorMsg.value = parsed.reason;
    return;
  }
  emit("payload-ready", parsed.payload, parsed.migratedEntityCount, parsed.integrityWarnings);
}

// Last, so the filter state `start` resets already exists.
watch(() => props.incoming, (next) => {
  if (next && next.length > 0) void start(next);
}, { immediate: true });

const STEPS = [
  { n: 1, label: "Load pack" },
  { n: 2, label: "Review plan" },
  { n: 3, label: "Pick and import" },
] as const;
</script>

<script lang="ts">
/** Rows rendered before "Show more"; big packs have thousands. */
const PAGE = 150;
</script>

<template>
  <div class="wp-pack" data-test="pack-converter" :aria-busy="busy">
    <ol class="wp-pack__steps" aria-label="Steps">
      <li
        v-for="s in STEPS"
        :key="s.n"
        class="wp-pack__step"
        :data-state="step === s.n ? 'current' : step > s.n ? 'done' : 'todo'"
        :aria-current="step === s.n ? 'step' : undefined"
      >
        <span class="wp-pack__step-n">
          <i v-if="step > s.n" class="pi pi-check" aria-hidden="true" />
          <template v-else>{{ s.n }}</template>
        </span>
        {{ s.label }}
      </li>
    </ol>

    <!-- Step 1: load -->
    <template v-if="step === 1">
      <div
        class="wp-pack__drop"
        :class="{ 'wp-pack__drop--active': dragging }"
        data-test="pack-dropzone"
        @dragover="onDragOver"
        @dragenter="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <i class="pi pi-sitemap wp-pack__drop-icon" aria-hidden="true" />
        <p class="wp-pack__drop-title">
          {{ busy ? "Converting the pack…" : dragging ? "Drop to convert" : "Drop a wildcard pack here" }}
        </p>
        <p class="wp-pack__drop-sub">
          Dynamic Prompts, Prompt-PostProcessor or Impact Pack wildcards: a folder, a
          <code>.zip</code>, or <code>.txt</code>, <code>.yaml</code> and <code>.json</code> files.
        </p>
        <div class="wp-pack__drop-actions">
          <button
            type="button" class="wp-pack__btn wp-pack__btn--primary" :disabled="busy"
            data-test="pack-pick-folder" @click="folderInput?.click()"
          ><i class="pi pi-folder-open" aria-hidden="true" /> Choose folder…</button>
          <button
            type="button" class="wp-pack__btn" :disabled="busy"
            data-test="pack-pick-files" @click="fileInput?.click()"
          ><i class="pi pi-file" aria-hidden="true" /> Choose files or zip…</button>
        </div>
        <input
          ref="fileInput" type="file" multiple :accept="WILDCARD_FILE_ACCEPT"
          class="wp-pack__hidden" aria-hidden="true" tabindex="-1"
          data-test="pack-files-input" @change="onPick"
        />
        <input
          ref="folderInput" type="file" webkitdirectory
          class="wp-pack__hidden" aria-hidden="true" tabindex="-1"
          data-test="pack-folder-input" @change="onPick"
        />
      </div>

      <div class="wp-pack__explain">
        <div v-for="role in PLAN_ROLES" :key="role" class="wp-pack__explain-card">
          <span class="wp-pack__role" :data-role="role">{{ ROLE_LABEL[role] }}</span>
          <p>{{ ROLE_HINT[role] }}</p>
        </div>
      </div>
    </template>

    <!-- Step 3: folded bar above the host's picker -->
    <div v-else-if="step === 3 && report" class="wp-pack__bar" data-test="pack-loaded">
      <i class="pi pi-sitemap wp-pack__bar-icon" aria-hidden="true" />
      <span class="wp-pack__bar-text">
        <strong>{{ options.packName || "Wildcard pack" }}</strong>:
        {{ plural(report.wildcards + report.groups, "wildcard", "wildcards") }},
        {{ plural(report.bundles, "bundle", "bundles") }}. Pick what to import below.
      </span>
      <button type="button" class="wp-pack__btn" data-test="pack-back" @click="emit('back')">
        <i class="pi pi-arrow-left" aria-hidden="true" /> Back to review
      </button>
    </div>

    <!-- Step 2: review the plan -->
    <template v-else-if="report">
      <header class="wp-pack__head">
        <div class="wp-pack__head-text">
          <h2 class="wp-pack__title">{{ options.packName || "Wildcard pack" }}</h2>
          <p class="wp-pack__sub" data-test="pack-summary">
            {{ plural(report.wildcards, "wildcard", "wildcards") }}<template v-if="report.groups">
              + {{ plural(report.groups, "group", "groups") }}</template>
            with {{ plural(report.options, "option", "options") }} from
            {{ plural(readFiles, "file", "files") }}.
          </p>
        </div>
        <button type="button" class="wp-pack__btn wp-pack__btn--ghost" data-test="pack-start-over" @click="startOver">
          <i class="pi pi-replay" aria-hidden="true" /> Start over
        </button>
      </header>

      <div class="wp-pack__stats" role="group" aria-label="Filter by role">
        <button
          v-for="role in PLAN_ROLES"
          :key="role"
          type="button"
          class="wp-pack__stat"
          :data-role="role"
          :aria-pressed="roles.has(role)"
          :title="ROLE_HINT[role]"
          :data-test="`pack-stat-${role}`"
          @click="toggleRole(role)"
        >
          <span class="wp-pack__stat-n">{{ summary.roles[role].toLocaleString() }}</span>
          <span class="wp-pack__stat-label">{{ ROLE_LABEL[role] }}</span>
        </button>
        <div class="wp-pack__fidelity">
          <span class="wp-pack__fidelity-label">How it carries over</span>
          <div class="wp-pack__meter" aria-hidden="true">
            <span
              v-for="f in PLAN_FIDELITIES" :key="f"
              class="wp-pack__meter-seg" :data-fidelity="f"
              :style="{ width: share(summary.fidelity[f]) }"
            />
          </div>
          <div class="wp-pack__fidelity-keys" role="group" aria-label="Filter by fidelity">
            <button
              v-for="f in PLAN_FIDELITIES" :key="f"
              type="button" class="wp-pack__key" :data-fidelity="f"
              :aria-pressed="fidelities.has(f)"
              :data-test="`pack-fidelity-${f}`"
              @click="toggleFidelity(f)"
            >
              <span class="wp-pack__dot" :data-fidelity="f" aria-hidden="true" />
              {{ FIDELITY_LABEL[f] }} {{ summary.fidelity[f].toLocaleString() }}
            </button>
          </div>
        </div>
      </div>

      <div class="wp-pack__grid">
        <nav class="wp-pack__domains" aria-label="Domains" data-test="pack-domains">
          <p class="wp-pack__col-title">Domains</p>
          <button
            type="button" class="wp-pack__domain" :aria-pressed="domain === null"
            @click="domain = null"
          >
            <span class="wp-pack__domain-name">All</span>
            <span class="wp-pack__domain-n">{{ plan.length.toLocaleString() }}</span>
          </button>
          <button
            v-for="d in summary.domains" :key="d.name"
            type="button" class="wp-pack__domain" :aria-pressed="domain === d.name"
            :title="`${d.entries} entry points, ${d.lossy} need a look`"
            @click="domain = d.name"
          >
            <span class="wp-pack__domain-name">{{ domainLabel(d.name) }}</span>
            <span v-if="d.lossy" class="wp-pack__dot" data-fidelity="lossy" aria-hidden="true" />
            <span class="wp-pack__domain-n">{{ d.count.toLocaleString() }}</span>
          </button>
        </nav>

        <section class="wp-pack__list" aria-label="Plan">
          <div class="wp-pack__toolbar">
            <input
              v-model="query" class="wp-pack__input wp-pack__search" type="search"
              placeholder="Search wildcards" aria-label="Search wildcards" data-test="pack-search"
            />
            <span class="wp-pack__count">{{ plural(rows.length, "wildcard", "wildcards") }}</span>
          </div>
          <div class="wp-pack__table" role="table" aria-label="Wildcards in the plan" data-test="pack-plan">
            <div class="wp-pack__tr wp-pack__tr--head" role="row">
              <span role="columnheader">Wildcard</span>
              <span role="columnheader">Role</span>
              <span role="columnheader" class="wp-pack__num">Options</span>
              <span role="columnheader" class="wp-pack__num">Used by</span>
              <span role="columnheader">Carries over</span>
            </div>
            <template v-for="item in visibleRows" :key="item.id">
              <button
                type="button" class="wp-pack__tr" role="row"
                :aria-expanded="openRow === item.id"
                data-test="pack-row"
                @click="openRow = openRow === item.id ? null : item.id"
              >
                <span role="cell" class="wp-pack__name" :title="item.name">{{ item.name }}</span>
                <span role="cell"><span class="wp-pack__role" :data-role="item.role">{{ ROLE_LABEL[item.role] }}</span></span>
                <span role="cell" class="wp-pack__num">{{ item.options.toLocaleString() }}</span>
                <span role="cell" class="wp-pack__num">{{ item.referenced_by || "" }}</span>
                <span role="cell" class="wp-pack__fid">
                  <span class="wp-pack__dot" :data-fidelity="item.fidelity" aria-hidden="true" />
                  {{ FIDELITY_LABEL[item.fidelity] }}
                </span>
              </button>
              <div v-if="openRow === item.id" class="wp-pack__detail" role="row">
                <p class="wp-pack__detail-line">
                  {{ ROLE_HINT[item.role] }}
                  <template v-if="item.source">From <code>{{ item.source }}</code>.</template>
                </p>
                <ul v-if="item.notes.length" class="wp-pack__detail-notes">
                  <li v-for="(n, i) in item.notes" :key="i">
                    <i
                      :class="['pi', noteNeedsAttention(n.kind) ? 'pi-exclamation-triangle wp-pack__warn' : 'pi-info-circle wp-pack__info']"
                      aria-hidden="true"
                    />
                    <span>{{ describeNote(n.kind) }}</span>
                    <code>{{ n.detail }}</code>
                  </li>
                </ul>
                <p v-else class="wp-pack__detail-line">Converted exactly.</p>
              </div>
            </template>
            <p v-if="rows.length === 0" class="wp-pack__empty">No wildcards match.</p>
          </div>
          <button
            v-if="rows.length > shown" type="button" class="wp-pack__btn wp-pack__more"
            @click="shown += PAGE"
          >Show {{ Math.min(PAGE, rows.length - shown) }} more</button>
        </section>

        <aside class="wp-pack__side">
          <section class="wp-pack__card" data-test="pack-settings">
            <p class="wp-pack__col-title">Import settings</p>
            <label class="wp-pack__field">
              <span class="wp-pack__label">Pack name</span>
              <input v-model="packName" class="wp-pack__input" placeholder="Imported wildcards" data-test="pack-name" />
            </label>
            <label class="wp-pack__field">
              <span class="wp-pack__label">Library tag</span>
              <input v-model="packTag" class="wp-pack__input" placeholder="none" data-test="pack-tag" />
            </label>
            <label class="wp-pack__field">
              <span class="wp-pack__label">Category</span>
              <input v-model="category" class="wp-pack__input" placeholder="one per domain" data-test="pack-category" />
            </label>
            <label class="wp-pack__check">
              <input v-model="bundles" type="checkbox" data-test="pack-bundles" />
              Bundle the entry points
            </label>
            <p class="wp-pack__hint">{{ bundleLine }}</p>
            <button
              type="button" class="wp-pack__btn wp-pack__btn--primary"
              :disabled="!dirty || busy" data-test="pack-apply" @click="apply"
            >{{ busy ? "Converting…" : "Apply" }}</button>
          </section>

          <section class="wp-pack__card">
            <button
              type="button" class="wp-pack__fold" :aria-expanded="filesOpen"
              data-test="pack-files-toggle" @click="filesOpen = !filesOpen"
            >
              <i :class="['pi', filesOpen ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" />
              Files ({{ report.files.length }})
              <span v-if="problemFiles" class="wp-pack__dot" data-fidelity="close" aria-hidden="true" />
            </button>
            <ul v-if="filesOpen" class="wp-pack__files" data-test="pack-files">
              <li
                v-for="f in report.files" :key="f.path" class="wp-pack__file"
                :class="{
                  'wp-pack__file--error': f.status === 'error',
                  'wp-pack__file--off': excluded.has(f.path),
                  'wp-pack__file--dup': !!f.duplicates,
                }"
              >
                <label class="wp-pack__file-label">
                  <input
                    type="checkbox" :checked="!excluded.has(f.path)"
                    :disabled="f.status === 'error'" @change="toggleFile(f.path)"
                  />
                  <span class="wp-pack__file-path">{{ f.path }}</span>
                </label>
                <span class="wp-pack__file-status">{{ fileStatus(f) }}</span>
              </li>
            </ul>
          </section>

          <section v-if="notes.length" class="wp-pack__card" data-test="pack-notes">
            <p class="wp-pack__col-title">Conversion notes</p>
            <ul class="wp-pack__notes">
              <li v-for="n in notes" :key="n.kind">
                <button
                  type="button" class="wp-pack__note" :aria-expanded="openNote === n.kind"
                  @click="openNote = openNote === n.kind ? null : n.kind"
                >
                  <i
                    :class="['pi', noteNeedsAttention(n.kind) ? 'pi-exclamation-triangle wp-pack__warn' : 'pi-info-circle wp-pack__info']"
                    aria-hidden="true"
                  />
                  <span class="wp-pack__note-text">{{ describeNote(n.kind) }}</span>
                  <span class="wp-pack__note-n">{{ n.count }}</span>
                </button>
                <ul v-if="openNote === n.kind" class="wp-pack__examples">
                  <li v-for="(ex, i) in n.examples" :key="i">
                    <span class="wp-pack__ex-name">{{ ex.wildcard }}</span>
                    <code>{{ ex.detail }}</code>
                  </li>
                  <li v-if="n.count > n.examples.length" class="wp-pack__ex-more">
                    and {{ n.count - n.examples.length }} more
                  </li>
                </ul>
              </li>
            </ul>
          </section>
        </aside>
      </div>

      <footer class="wp-pack__footer">
        <span class="wp-pack__footer-text">
          {{ plural(report.wildcards + report.groups, "wildcard", "wildcards") }}
          <template v-if="report.bundles"> and {{ plural(report.bundles, "bundle", "bundles") }}</template>
          ready. You pick what to import next.
        </span>
        <button
          type="button" class="wp-pack__btn wp-pack__btn--primary"
          :disabled="busy || dirty" :title="dirty ? 'Apply your settings first' : undefined"
          data-test="pack-continue" @click="continueToImport"
        >Continue to import <i class="pi pi-arrow-right" aria-hidden="true" /></button>
      </footer>
    </template>

    <div v-if="errorMsg" class="wp-pack__error" role="alert" data-test="pack-error">{{ errorMsg }}</div>
  </div>
</template>

<style scoped>
.wp-pack { display: flex; flex-direction: column; gap: var(--wp-space-6); font-size: var(--wp-text-sm); }
.wp-pack[aria-busy="true"] .wp-pack__grid { opacity: 0.6; }

/* Stepper */
.wp-pack__steps { display: flex; gap: var(--wp-space-3); margin: 0; padding: 0; list-style: none; flex-wrap: wrap; }
.wp-pack__step {
  display: inline-flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-2) var(--wp-space-5) var(--wp-space-2) var(--wp-space-2);
  border: 1px solid var(--wp-border); border-radius: 999px;
  color: var(--wp-text-muted); background: var(--wp-bg-2);
}
.wp-pack__step[data-state="current"] { color: var(--wp-text); border-color: var(--wp-accent-500); }
.wp-pack__step[data-state="done"] { color: var(--wp-text); }
.wp-pack__step-n {
  display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 999px;
  background: var(--wp-bg-3); font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
}
.wp-pack__step[data-state="current"] .wp-pack__step-n { background: var(--wp-accent-500); color: #fff; } /* audit-exempt: white on accent-500 ≥4.5:1 */
.wp-pack__step[data-state="done"] .wp-pack__step-n { background: color-mix(in oklab, var(--wp-success) 25%, transparent); color: var(--wp-success); }

/* Step 1 */
.wp-pack__drop {
  display: flex; flex-direction: column; align-items: center; gap: var(--wp-space-4);
  padding: var(--wp-space-8) var(--wp-space-6);
  border: 2px dashed var(--wp-border); border-radius: var(--wp-radius-lg);
  background: var(--wp-bg-2); text-align: center;
}
.wp-pack__drop--active { border-color: var(--wp-accent-500); background: color-mix(in oklab, var(--wp-accent-500) 8%, var(--wp-bg-2)); }
.wp-pack__drop-icon { font-size: var(--wp-text-3xl); color: var(--wp-accent-500); }
.wp-pack__drop-title { margin: 0; font-size: var(--wp-text-lg); font-weight: var(--wp-weight-semibold); color: var(--wp-text); }
.wp-pack__drop-sub { margin: 0; max-width: 560px; color: var(--wp-text-muted); }
.wp-pack__drop-actions { display: flex; gap: var(--wp-space-4); flex-wrap: wrap; justify-content: center; }
.wp-pack__hidden { display: none; }
.wp-pack__explain { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--wp-space-4); }
.wp-pack__explain-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--wp-space-3);
  padding: var(--wp-space-5); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-2);
}
.wp-pack__explain-card p { margin: 0; color: var(--wp-text-muted); }

/* Role chips + fidelity dots */
.wp-pack__role {
  --role: var(--wp-text-muted);
  display: inline-flex; align-items: center; padding: 0 var(--wp-space-3); height: 20px;
  border-radius: 999px; font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  color: var(--role); background: color-mix(in oklab, var(--role) 16%, transparent);
  border: 1px solid color-mix(in oklab, var(--role) 40%, transparent); white-space: nowrap;
}
[data-role="entry"] { --role: var(--wp-accent-400); }
[data-role="composition"] { --role: var(--wp-info); }
[data-role="vocabulary"] { --role: var(--wp-text-muted); }
[data-role="group"] { --role: var(--wp-success); }
.wp-pack__dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; background: var(--wp-text-dim); }
.wp-pack__dot[data-fidelity="exact"], .wp-pack__meter-seg[data-fidelity="exact"] { background: var(--wp-success); }
.wp-pack__dot[data-fidelity="close"], .wp-pack__meter-seg[data-fidelity="close"] { background: var(--wp-warn); }
.wp-pack__dot[data-fidelity="lossy"], .wp-pack__meter-seg[data-fidelity="lossy"] { background: var(--wp-danger); }

/* Step 2 header + stats */
.wp-pack__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--wp-space-5); }
.wp-pack__title { margin: 0; font-size: var(--wp-text-lg); font-weight: var(--wp-weight-semibold); color: var(--wp-text); }
.wp-pack__sub { margin: var(--wp-space-1) 0 0; color: var(--wp-text-muted); }
.wp-pack__stats { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)) minmax(260px, 2fr); gap: var(--wp-space-4); }
.wp-pack__stat {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--wp-space-1);
  padding: var(--wp-space-4) var(--wp-space-5); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md);
  background: var(--wp-bg-2); color: var(--wp-text); font: inherit; cursor: pointer; text-align: left;
  border-top: 3px solid var(--role);
}
.wp-pack__stat[aria-pressed="true"] { background: color-mix(in oklab, var(--role) 12%, var(--wp-bg-2)); border-color: var(--role); }
.wp-pack__stat-n { font-size: var(--wp-text-xl); font-weight: var(--wp-weight-semibold); font-variant-numeric: tabular-nums; }
.wp-pack__stat-label { color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-pack__fidelity {
  display: flex; flex-direction: column; gap: var(--wp-space-3); justify-content: center;
  padding: var(--wp-space-4) var(--wp-space-5); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-2);
}
.wp-pack__fidelity-label { color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-pack__meter { display: flex; gap: 2px; height: 8px; border-radius: 999px; overflow: hidden; background: var(--wp-bg-3); }
.wp-pack__meter-seg { height: 100%; }
.wp-pack__fidelity-keys { display: flex; flex-wrap: wrap; gap: var(--wp-space-2); }
.wp-pack__key {
  display: inline-flex; align-items: center; gap: var(--wp-space-2); padding: var(--wp-space-1) var(--wp-space-3);
  border: 1px solid transparent; border-radius: var(--wp-radius-sm); background: none; color: var(--wp-text); font: inherit;
  font-size: var(--wp-text-xs); cursor: pointer; font-variant-numeric: tabular-nums;
}
.wp-pack__key[aria-pressed="true"] { border-color: var(--wp-border); background: var(--wp-bg-3); }

/* Step 2 grid */
.wp-pack__grid { display: grid; grid-template-columns: 200px minmax(0, 1fr) 280px; gap: var(--wp-space-5); align-items: start; }
.wp-pack__col-title { margin: 0 0 var(--wp-space-2); color: var(--wp-text-muted); font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold); text-transform: uppercase; letter-spacing: 0.04em; }
.wp-pack__domains { display: flex; flex-direction: column; gap: var(--wp-space-1); position: sticky; top: var(--wp-space-4); max-height: 70vh; overflow: auto; }
.wp-pack__domain {
  display: flex; align-items: center; gap: var(--wp-space-3); padding: var(--wp-space-2) var(--wp-space-3);
  border: 0; border-radius: var(--wp-radius-sm); background: none; color: var(--wp-text); font: inherit; cursor: pointer; text-align: left;
}
.wp-pack__domain:hover { background: var(--wp-bg-hover); }
.wp-pack__domain[aria-pressed="true"] { background: var(--wp-bg-3); font-weight: var(--wp-weight-semibold); }
.wp-pack__domain-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-pack__domain-n { color: var(--wp-text-muted); font-size: var(--wp-text-xs); font-variant-numeric: tabular-nums; }

.wp-pack__list { display: flex; flex-direction: column; gap: var(--wp-space-3); min-width: 0; }
.wp-pack__toolbar { display: flex; align-items: center; gap: var(--wp-space-4); }
.wp-pack__search { flex: 1; }
.wp-pack__count { color: var(--wp-text-muted); font-size: var(--wp-text-xs); white-space: nowrap; }
.wp-pack__table { border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-1); overflow: hidden; }
.wp-pack__tr {
  display: grid; grid-template-columns: minmax(0, 1fr) 110px 64px 64px 120px; gap: var(--wp-space-4); align-items: center;
  width: 100%; padding: var(--wp-space-2) var(--wp-space-4); border: 0; border-bottom: 1px solid var(--wp-border);
  background: none; color: var(--wp-text); font: inherit; text-align: left; cursor: pointer;
}
.wp-pack__tr:hover { background: var(--wp-bg-hover); }
.wp-pack__tr--head { cursor: default; color: var(--wp-text-muted); font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold); background: var(--wp-bg-2); }
.wp-pack__tr--head:hover { background: var(--wp-bg-2); }
.wp-pack__tr[aria-expanded="true"] { background: var(--wp-bg-2); }
.wp-pack__name { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-pack__num { text-align: right; font-variant-numeric: tabular-nums; color: var(--wp-text-muted); }
.wp-pack__fid { display: inline-flex; align-items: center; gap: var(--wp-space-2); font-size: var(--wp-text-xs); }
.wp-pack__detail { display: flex; flex-direction: column; gap: var(--wp-space-2); padding: var(--wp-space-3) var(--wp-space-5) var(--wp-space-4); border-bottom: 1px solid var(--wp-border); background: var(--wp-bg-2); }
.wp-pack__detail-line { margin: 0; color: var(--wp-text-muted); }
.wp-pack__detail-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-2); }
.wp-pack__detail-notes li { display: flex; align-items: baseline; gap: var(--wp-space-3); flex-wrap: wrap; }
.wp-pack__detail-notes code, .wp-pack__examples code { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); overflow-wrap: anywhere; color: var(--wp-text); }
.wp-pack__empty { margin: 0; padding: var(--wp-space-5); color: var(--wp-text-muted); text-align: center; }
.wp-pack__more { align-self: center; }

/* Side column */
.wp-pack__side { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wp-pack__card { display: flex; flex-direction: column; gap: var(--wp-space-3); padding: var(--wp-space-4) var(--wp-space-5); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-2); }
.wp-pack__field { display: flex; flex-direction: column; gap: var(--wp-space-1); }
.wp-pack__label { color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-pack__input {
  height: var(--wp-btn-h); padding: 0 var(--wp-space-4); background: var(--wp-bg-1); color: var(--wp-text);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm); font: inherit;
}
.wp-pack__input:focus-visible { outline: none; border-color: var(--wp-accent-500); box-shadow: var(--wp-focus-ring); }
.wp-pack__check { display: flex; align-items: center; gap: var(--wp-space-3); color: var(--wp-text); }
.wp-pack__hint { margin: 0; color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-pack__fold {
  display: inline-flex; align-items: center; gap: var(--wp-space-3); padding: 0; border: 0; background: none;
  color: var(--wp-text); font: inherit; font-weight: var(--wp-weight-semibold); cursor: pointer;
}
.wp-pack__files { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm); background: var(--wp-bg-1); }
.wp-pack__file { display: flex; flex-direction: column; gap: var(--wp-space-1); padding: var(--wp-space-2) var(--wp-space-3); border-bottom: 1px solid var(--wp-border); }
.wp-pack__file:last-child { border-bottom: 0; }
.wp-pack__file-label { display: flex; align-items: center; gap: var(--wp-space-2); min-width: 0; }
.wp-pack__file-path { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); overflow-wrap: anywhere; }
.wp-pack__file-status { color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-pack__file--off .wp-pack__file-path { color: var(--wp-text-dim); text-decoration: line-through; }
.wp-pack__file--error .wp-pack__file-status { color: var(--wp-danger); }
.wp-pack__file--dup .wp-pack__file-status { color: var(--wp-warn); }
.wp-pack__notes, .wp-pack__examples { list-style: none; margin: 0; padding: 0; }
.wp-pack__note {
  display: flex; align-items: flex-start; gap: var(--wp-space-3); width: 100%; padding: var(--wp-space-2) 0;
  border: 0; background: none; color: var(--wp-text); font: inherit; text-align: left; cursor: pointer;
}
.wp-pack__note-text { flex: 1; }
.wp-pack__note-n { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); color: var(--wp-text-muted); }
.wp-pack__examples { display: flex; flex-direction: column; gap: var(--wp-space-2); margin: 0 0 var(--wp-space-3) var(--wp-space-6); }
.wp-pack__examples li { display: flex; flex-direction: column; gap: var(--wp-space-1); }
.wp-pack__ex-name { color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-pack__ex-more { color: var(--wp-text-dim); }
.wp-pack__warn { color: var(--wp-warn); }
.wp-pack__info { color: var(--wp-text-dim); }

/* Footer + folded bar */
.wp-pack__footer, .wp-pack__bar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--wp-space-5);
  padding: var(--wp-space-4) var(--wp-space-5); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-2);
}
.wp-pack__footer { position: sticky; bottom: var(--wp-space-4); box-shadow: 0 6px 24px rgb(0 0 0 / 0.25); }
.wp-pack__footer-text, .wp-pack__bar-text { color: var(--wp-text-muted); flex: 1; }
.wp-pack__bar-text strong { color: var(--wp-text); }
.wp-pack__bar-icon { color: var(--wp-accent-500); }

/* Buttons */
.wp-pack__btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--wp-space-2);
  height: var(--wp-btn-h); padding: 0 var(--wp-space-5); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-3); color: var(--wp-text); font: inherit; font-weight: var(--wp-weight-medium); cursor: pointer; white-space: nowrap;
}
.wp-pack__btn:hover:not(:disabled) { background: var(--wp-bg-hover); }
.wp-pack__btn--primary {
  background: linear-gradient(180deg, var(--wp-accent-500), var(--wp-accent-600)); border-color: var(--wp-accent-600);
  /* audit-exempt: white on saturated accent-500/600 gradient ≥4.5:1 both themes */
  color: #fff;
}
.wp-pack__btn--primary:hover:not(:disabled) { background: linear-gradient(180deg, var(--wp-accent-400), var(--wp-accent-500)); }
.wp-pack__btn--ghost { background: none; border-color: transparent; color: var(--wp-text-muted); }
.wp-pack__btn:disabled { opacity: 0.45; cursor: default; }
.wp-pack__error { padding: var(--wp-space-4) var(--wp-space-5); border: 1px solid var(--wp-danger); border-radius: var(--wp-radius-sm); color: var(--wp-danger); background: color-mix(in oklab, var(--wp-danger) 8%, transparent); }

@media (max-width: 1100px) {
  .wp-pack__grid { grid-template-columns: minmax(0, 1fr); }
  .wp-pack__domains { position: static; flex-direction: row; flex-wrap: wrap; max-height: none; }
  .wp-pack__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wp-pack__fidelity { grid-column: 1 / -1; }
}
</style>
