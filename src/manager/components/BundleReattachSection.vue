<script setup lang="ts">
/**
 * BundleReattachSection — heals a bundle whose frozen child `id` no longer
 * resolves in the library ("Child N: target module/bundle missing"). The
 * bundle analog of ConstraintReattachSection: renders ABOVE the CHILDREN
 * card in BundleEditor, one red row per dangling child.
 *
 * Per dangling child: the dead id (sliced) + cached name, a "Reattach"
 * button opening a searchable candidate dropdown filtered to the matching
 * kind (a `type:"bundle"` child picks a local BUNDLE, every other leaf-module
 * child picks a local MODULE — same discrimination as `validateBundle`), and
 * — when the child is `downloadable` — a "Download from community" button.
 *
 * On confirm the parent rewrites the child's `id` via `walkRemap` + saves;
 * on download the parent pulls the missing dep's closure then re-resolves.
 * This is UI-layer reference-healing only — it doesn't touch the engine.
 */
import { ref } from "vue";

interface DanglingChild {
  childId: string;
  /** Engine `type` — `"bundle"` picks BUNDLE candidates, else MODULE. */
  type: string;
  cachedName: string;
}
interface Candidate {
  id: string;
  name: string;
}

const props = withDefaults(defineProps<{
  danglingChildren: DanglingChild[];
  /** Local leaf-module candidates (the module store catalog). */
  moduleCandidates: Candidate[];
  /** Local bundle candidates (the bundle store catalog). */
  bundleCandidates: Candidate[];
  /** Child ids whose missing id is provided by a community dep edge — gates
   *  the per-child "Download from community" button (Feature 2 analog). */
  downloadableChildIds?: string[];
}>(), { downloadableChildIds: () => [] });

const emit = defineEmits<{
  /** Manual reattach confirmed for a child. The parent runs walkRemap +
   *  saves the bundle. */
  reattach: [payload: { childId: string; newId: string; newName: string }];
  /** "Download from community" clicked for a child. The parent resolves the
   *  dep closure, confirms, pulls + installs; reattach falls out of local
   *  resolution afterwards. */
  downloadreattach: [payload: { childId: string }];
}>();

// Which child's dropdown is open (childId), the live search query, and the
// current pick. Single-open: opening one row's dropdown closes any other.
const openChildId = ref<string | null>(null);
const query = ref("");
const picked = ref<Candidate | null>(null);

/** Candidate pool for a child, filtered to its kind + the live query. The
 *  cached name is the SORT KEY (auto-suggest) — an exact match floats to the
 *  top WITHOUT filtering others out (mirrors ConstraintReattachSection). */
function candidatesFor(child: DanglingChild): Candidate[] {
  const pool = child.type === "bundle" ? props.bundleCandidates : props.moduleCandidates;
  const q = query.value.trim().toLowerCase();
  const cached = child.cachedName.trim().toLowerCase();
  const out = pool.filter((c) => !q || c.name.toLowerCase().includes(q));
  return [...out].sort((a, b) => {
    const ax = a.name.toLowerCase() === cached ? 0 : 1;
    const bx = b.name.toLowerCase() === cached ? 0 : 1;
    return ax !== bx ? ax - bx : a.name.localeCompare(b.name);
  });
}

function isDownloadable(childId: string): boolean {
  return props.downloadableChildIds.includes(childId);
}

function openDropdown(childId: string): void {
  openChildId.value = childId;
  // Empty query keeps every candidate visible; the cached name is the sort
  // key in candidatesFor (auto-suggest), floating an exact match to the top.
  query.value = "";
  picked.value = null;
}

function pick(c: Candidate): void {
  picked.value = c;
}

function confirm(childId: string): void {
  if (!picked.value) return;
  emit("reattach", { childId, newId: picked.value.id, newName: picked.value.name });
  openChildId.value = null;
  picked.value = null;
}
</script>

<template>
  <section class="rb" data-test="bundle-reattach-section">
    <div class="rb__label">Broken children</div>

    <div
      v-for="child in danglingChildren"
      :key="child.childId"
      class="rb__row"
      :data-test="`bundle-reattach-row-${child.childId}`"
    >
      <i class="pi pi-exclamation-triangle rb__warn-icon" aria-hidden="true" />
      <span class="rb__txt">
        {{ child.type === "bundle" ? "Bundle" : "Module" }}
        <code>{{ child.childId.slice(0, 8) }}</code>
        <span v-if="child.cachedName"> (was “{{ child.cachedName }}”)</span>
        is not in your library.
      </span>
      <button
        type="button"
        class="rb__btn"
        :data-test="`bundle-reattach-btn-${child.childId}`"
        @click="openDropdown(child.childId)"
      >Reattach</button>
      <button
        v-if="isDownloadable(child.childId)"
        type="button"
        class="rb__btn rb__btn--download"
        :data-test="`bundle-reattach-download-${child.childId}`"
        @click="emit('downloadreattach', { childId: child.childId })"
      ><i class="pi pi-cloud-download" aria-hidden="true" /> Download from community</button>

      <div v-if="openChildId === child.childId" class="rb__picker">
        <input
          v-model="query"
          type="text"
          class="rb__search"
          :placeholder="child.type === 'bundle' ? 'Search bundles…' : 'Search modules…'"
          spellcheck="false"
          :aria-label="`Search candidates to reattach ${child.cachedName || child.childId}`"
        />
        <ul class="rb__list">
          <li
            v-for="c in candidatesFor(child)"
            :key="c.id"
            class="rb__cand"
            data-test="bundle-reattach-candidate"
            :data-test-id="`bundle-reattach-candidate-${c.id}`"
            :class="{ 'rb__cand--picked': c.id === picked?.id }"
            @click="pick(c)"
          >
            <span class="rb__cand-name" data-test="bundle-reattach-cand-name">{{ c.name }}</span>
            <code class="rb__cand-id">{{ c.id }}</code>
          </li>
          <li v-if="candidatesFor(child).length === 0" class="rb__empty">
            No local {{ child.type === "bundle" ? "bundles" : "modules" }} to reattach.
          </li>
        </ul>
        <p class="rb__note">Cancel is the only undo — confirm rewrites the child + saves.</p>
        <button
          type="button"
          class="rb__confirm"
          :data-test="`bundle-reattach-confirm-${child.childId}`"
          :disabled="!picked || undefined"
          @click="confirm(child.childId)"
        >Confirm reattach</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rb {
  padding: 12px 16px;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 6%, var(--wp-bg2, #15151f));
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: var(--wp-radius, 4px);
  margin-bottom: var(--wp-space-5, 16px);
}
.rb__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-danger, #ef4444);
  margin-bottom: 8px;
}
.rb__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: 11px var(--wp-font-sans); padding: 4px 0; }
.rb__warn-icon { color: var(--wp-danger, #ef4444); font-size: 12px; }
.rb__txt { flex: 1; color: var(--wp-text, #e7e7ee); }
.rb__txt code { font-family: var(--wp-font-mono, monospace); }
.rb__btn,
.rb__confirm {
  padding: 4px 12px;
  border: 1px solid var(--wp-accent, #8b5cf6);
  border-radius: 4px;
  background: transparent;
  color: var(--wp-accent-text, var(--wp-text));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.rb__confirm { background: var(--wp-accent, #8b5cf6); color: #fff; margin-top: 6px; }
/* Secondary affordance beside Reattach — pulls the missing dep from the
 * community. Quieter than the primary accent border so the manual dropdown
 * stays the obvious first action; the cloud icon signals the network pull. */
.rb__btn--download {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-color: var(--wp-border, rgba(255,255,255,0.12));
  color: var(--wp-text-muted, var(--wp-text2, var(--wp-text)));
}
.rb__btn--download:hover {
  border-color: var(--wp-accent, #8b5cf6);
  color: var(--wp-accent-text, var(--wp-text));
}
.rb__btn--download .pi { font-size: 11px; }
.rb__picker {
  flex-basis: 100%;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--wp-border, rgba(255,255,255,0.12));
  border-radius: 6px;
  background: var(--wp-bg, #11111b);
}
.rb__search {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  border-radius: 4px;
  border: 1px solid var(--wp-border, rgba(255,255,255,0.12));
  background: var(--wp-bg-2, #15151f);
  color: var(--wp-text, #e7e7ee);
  font: 12px var(--wp-font-mono, monospace);
  outline: none;
}
.rb__list { list-style: none; margin: 6px 0; padding: 0; max-height: 150px; overflow-y: auto; }
.rb__cand { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: var(--wp-text, #e7e7ee); }
.rb__cand-name { font: 11px var(--wp-font-sans); }
.rb__cand-id { flex-shrink: 0; font: 10px var(--wp-font-mono, monospace); color: var(--wp-text-dim, #6e6e7c); }
.rb__cand:hover { background: color-mix(in oklab, var(--wp-accent, #8b5cf6) 18%, transparent); }
.rb__cand--picked { background: color-mix(in oklab, var(--wp-accent, #8b5cf6) 28%, transparent); }
.rb__empty { padding: 5px 8px; font: 11px var(--wp-font-sans); color: var(--wp-text-dim, #6e6e7c); }
.rb__note { margin: 6px 0 0; font: 10px var(--wp-font-sans); color: var(--wp-text-dim, #6e6e7c); }
</style>
