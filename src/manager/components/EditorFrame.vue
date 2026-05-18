<script setup lang="ts">
/**
 * EditorFrame
 *
 * Shared scaffold for the six module editors (Wildcard / Fixed / Combine /
 * Derivation / Constraint / Pipeline). Mirrors the prototype's
 * `EditorFrame` in `screens/editors.jsx`:
 *
 *   - top breadcrumb back-link
 *   - header with title + optional subtitle + free-form `header-extra` slot
 *   - body slot (cards laid out by each editor)
 *   - sticky footer with optional History button (left), Cancel + Save (right)
 *   - HistoryPanel mounted lazily (only when entries exist + opened)
 *
 * Drops PrimeVue entirely — uses the wave-1 `ui/Button` primitive plus the
 * `wp-page__*`, `wp-breadcrumb`, `wp-card`, `wp-footer-bar` tokens that
 * already live in `tokens.css`.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "./ui/Button.vue";
import HistoryPanel from "./HistoryPanel.vue";
import Breadcrumb from "./Breadcrumb.vue";
import type { BreadcrumbItem } from "./Breadcrumb.types";
import type { ModuleHistoryEntry } from "../api/types";
import type { SaveState, EditorSection, EditorFieldError } from "./EditorFrame.types";

interface Props {
  title: string;
  subtitle?: string;
  backRoute: string;
  backLabel: string;
  saving?: boolean;
  saveDisabled?: boolean;
  historyEntries?: ModuleHistoryEntry[];
  /** Optional. When provided, renders a multi-segment Breadcrumb at
   *  the top instead of the single back link. */
  breadcrumb?: BreadcrumbItem[];
  /** When true, render an "Unsaved" chip and accent the Save button. */
  dirty?: boolean;
  /** Save button state-machine. When set to anything other than "idle"
   *  it wins over the legacy `saving` boolean. Editors flash "saved" /
   *  "error" for ~1.5–3s then return to "idle". */
  saveState?: SaveState;
  /** Tooltip surfaced on the Save button when `saveState === "error"`. */
  saveError?: string;
  /** Opt-in section-anchor side rail. When provided AND length >= 3,
   *  EditorFrame renders a sticky right-column nav with scroll-spy
   *  highlighting. Each `id` must match a DOM id on a card (or
   *  card-wrapper `<div>`) in the body slot. */
  sections?: EditorSection[];
  /** Field validation errors. When non-empty, renders a top-of-body
   *  rollup with anchor links that scroll to + focus the offending
   *  field. Editors typically gate visibility behind a "tried to save
   *  while invalid" flag so the banner is feedback, not nagging. */
  errors?: EditorFieldError[];
}

const props = withDefaults(defineProps<Props>(), {
  saving: false,
  saveDisabled: false,
  historyEntries: () => [],
  dirty: false,
  saveState: "idle",
  saveError: "",
  sections: () => [],
  errors: () => [],
});

const emit = defineEmits<{
  (e: "save"): void;
  (e: "cancel"): void;
  (e: "restore", entry: ModuleHistoryEntry): void;
}>();

const historyOpen = ref(false);

/** Effective state — explicit `saveState` prop wins over the legacy
 *  `saving` boolean so editors mid-migration still flip the spinner. */
const effectiveSaveState = computed<SaveState>(() => {
  if (props.saveState && props.saveState !== "idle") return props.saveState;
  if (props.saving) return "saving";
  return "idle";
});

const saveIcon = computed(() => ({
  idle:   "pi-check",
  saving: "pi-spinner",
  saved:  "pi-check-circle",
  error:  "pi-times-circle",
}[effectiveSaveState.value]));

const saveLabel = computed(() => ({
  idle:   "Save",
  saving: "Saving",
  saved:  "Saved",
  error:  "Retry",
}[effectiveSaveState.value]));

function onCancel() { emit("cancel"); }
function onSave() { emit("save"); }
function onRestore(entry: ModuleHistoryEntry) {
  emit("restore", entry);
  historyOpen.value = false;
}

/* Side-rail scroll-spy. Sections are opt-in; rail hides when fewer than 3.
 * IntersectionObserver fires as cards enter/leave the viewport; we pick the
 * entry with the largest visible ratio and mark its id active. The
 * rootMargin biases toward the upper-middle of the scroll region so the
 * "active" section feels anchored where the user is reading, not at the
 * very top edge.
 *
 * jsdom doesn't ship IntersectionObserver — guard so unit tests mount
 * cleanly without polyfilling the global. */
const activeSection = ref<string>("");
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (!props.sections.length || props.sections.length < 3) return;
  if (typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) activeSection.value = visible[0].target.id;
    },
    { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  for (const s of props.sections) {
    const el = document.getElementById(s.id);
    if (el) observer.observe(el);
  }
});

onBeforeUnmount(() => { observer?.disconnect(); observer = null; });

function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Field-error rollup anchor. Scrolls the target element into view
 *  (center-aligned so the field sits in the comfortable read zone)
 *  and focuses the first form control inside it. The control lookup
 *  handles both "id on the input itself" and "id on a wrapper card"
 *  so editors can anchor to either granularity. */
function scrollToField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.matches?.("input, textarea, select")
    ? (el as HTMLInputElement)
    : el.querySelector<HTMLInputElement>("input, textarea, select");
  input?.focus();
}
</script>

<template>
  <div class="wp-page wp-page--fill wp-editor">
    <Breadcrumb v-if="breadcrumb && breadcrumb.length" :items="breadcrumb" />
    <RouterLink
      v-else
      :to="backRoute"
      class="wp-breadcrumb"
      data-test="editor-back"
    >
      <i class="pi pi-angle-left" /> {{ backLabel }}
    </RouterLink>

    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">
          {{ title }}
          <span v-if="dirty" class="wp-editor__dirty-chip" data-test="editor-dirty-chip">
            <span class="wp-editor__dirty-dot" aria-hidden="true" />
            Unsaved
          </span>
        </h1>
        <p v-if="subtitle" class="wp-page__subtitle">{{ subtitle }}</p>
      </div>
      <slot name="header-extra" />
    </div>

    <slot name="draft-banner" />

    <div
      class="wp-editor__body-wrap"
      :class="{ 'wp-editor__body-wrap--with-rail': sections.length >= 3 }"
    >
      <div class="wp-editor__body">
        <div
          v-if="errors.length"
          class="wp-editor__errors"
          role="alert"
          data-test="editor-errors"
        >
          <div class="wp-editor__errors-title">
            {{ errors.length }} field{{ errors.length === 1 ? '' : 's' }} need{{ errors.length === 1 ? 's' : '' }} attention:
          </div>
          <ul>
            <li v-for="e in errors" :key="e.field + ':' + e.label">
              <a :href="`#${e.field}`" @click.prevent="scrollToField(e.field)">{{ e.label }}</a>
              <span class="wp-editor__errors-sep"> — </span>
              <span>{{ e.message }}</span>
            </li>
          </ul>
        </div>
        <slot />
      </div>
      <aside
        v-if="sections.length >= 3"
        class="wp-editor__rail"
        aria-label="Editor sections"
      >
        <a
          v-for="s in sections"
          :key="s.id"
          :href="`#${s.id}`"
          class="wp-editor__rail-link"
          :data-active="activeSection === s.id || undefined"
          @click.prevent="scrollToSection(s.id)"
        >{{ s.label }}</a>
      </aside>
    </div>

    <div class="wp-footer-bar">
      <div class="wp-footer-bar__inner">
        <Button
          v-if="historyEntries && historyEntries.length"
          variant="ghost"
          icon="pi-history"
          data-test="history-btn"
          @click="historyOpen = true"
        >
          History ({{ historyEntries.length }})
        </Button>
        <slot name="footer-left" />
        <span class="wp-spacer" />
        <Button variant="secondary" data-test="cancel-btn" @click="onCancel">Cancel</Button>
        <Button
          variant="primary"
          :icon="saveIcon"
          :loading="effectiveSaveState === 'saving'"
          :disabled="saveDisabled || effectiveSaveState === 'saving'"
          :data-dirty="dirty || undefined"
          :data-save-state="effectiveSaveState"
          :title="effectiveSaveState === 'error' ? saveError : undefined"
          data-test="save-btn"
          @click="onSave"
        >{{ saveLabel }}</Button>
      </div>
    </div>

    <HistoryPanel
      :open="historyOpen"
      :entries="historyEntries ?? []"
      @update:open="(v) => (historyOpen = v)"
      @restore="onRestore"
    />
  </div>
</template>

<style scoped>
/* `.wp-page--fill` parent is height:100% with min-height:0; we make the
   body the scroll region so the sticky footer never overlaps content. */
.wp-editor {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}
.wp-editor__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
  /* Buffer so the last card clears the gradient + sticky footer top. */
  padding-bottom: var(--wp-space-7);
}
.wp-editor__dirty-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  margin-left: var(--wp-space-4);
  padding: 2px var(--wp-space-3);
  background: color-mix(in oklab, var(--wp-warn, #facc15) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn, #facc15) 32%, transparent);
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  font-weight: 500;
  color: var(--wp-warn, #facc15);
  letter-spacing: 0.02em;
  text-transform: none;
  vertical-align: middle;
}
.wp-editor__dirty-dot {
  width: 6px; height: 6px;
  border-radius: 999px;
  background: currentColor;
}
/* Use :deep() so the rules reach the banner div which is rendered through
 * the `draft-banner` slot — slot content carries the parent editor's
 * data-v attribute, not EditorFrame's, so the default scoped selector
 * would miss the gap + spacing properties. */
:deep(.wp-draft-banner) {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-3) var(--wp-space-5);
  background: color-mix(in oklab, var(--wp-info, var(--wp-accent-500)) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-info, var(--wp-accent-500)) 30%, transparent);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
}
:deep(.wp-draft-banner) .pi { color: var(--wp-info, var(--wp-accent-500)); }
:deep(.wp-draft-banner) .wp-spacer { flex: 1; }

/* Footer-bar backdrop polish: solid colors don't read well when long-form
 * content peeks behind on scroll. Blur + a top-fade gradient give the bar
 * a soft floating feel without obscuring the cards above. */
.wp-footer-bar {
  position: relative;
  background: color-mix(in oklab, var(--wp-bg) 88%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-top: 1px solid var(--wp-border);
}
.wp-footer-bar::before {
  content: "";
  position: absolute;
  inset: -24px 0 100% 0;
  background: linear-gradient(to top, var(--wp-bg) 0%, transparent 100%);
  pointer-events: none;
}

/* Save button state-machine visuals. Base button styling lives in
 * tokens.css; this layers the saved/error nuance on top. */
:deep(.wp-btn[data-save-state="saved"]) {
  background: var(--wp-success, #22c55e);
  border-color: var(--wp-success, #22c55e);
}
:deep(.wp-btn[data-save-state="error"]) {
  background: var(--wp-danger, #ef4444);
  border-color: var(--wp-danger, #ef4444);
}
:deep(.wp-btn[data-dirty]:not([data-save-state="saved"]):not([data-save-state="error"])) {
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--wp-accent-500) 30%, transparent);
}

/* Section anchor side rail — opt-in via `sections` prop on EditorFrame.
 * Hidden when fewer than 3 sections (not worth the column) or on narrow
 * viewports. Highlight uses an IntersectionObserver-driven scroll-spy
 * keyed off each card's id.
 *
 * Body-wrap MUST be a flex container itself so the inner `.wp-editor__body`
 * keeps its `flex: 1 1 auto; min-height: 0` scroll-region behavior (we
 * inserted a wrapper between the parent flex column and the body, breaking
 * the original direct-child relationship). The grid variant overrides
 * display to position the rail alongside the body. */
.wp-editor__body-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.wp-editor__body-wrap--with-rail {
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: var(--wp-space-4);
}
.wp-editor__body-wrap--with-rail > .wp-editor__body { min-height: 0; }

/* Tightened rail — narrow column (96px), thin left border, dim text.
 * Active link picks up the accent. Sized to feel like a sidebar
 * indicator, not a second nav column. */
.wp-editor__rail {
  position: sticky;
  top: var(--wp-space-5);
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--wp-space-2) 0 var(--wp-space-2) var(--wp-space-3);
  border-left: 1px solid var(--wp-border);
}
.wp-editor__rail-link {
  display: block;
  padding: 4px var(--wp-space-2);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  text-decoration: none;
  border-radius: var(--wp-radius-sm);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-editor__rail-link:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-editor__rail-link[data-active] {
  color: var(--wp-text);
  background: color-mix(in oklab, var(--wp-accent-500) 15%, transparent);
}

@media (max-width: 1024px) {
  .wp-editor__body-wrap--with-rail { display: block; }
  .wp-editor__rail { display: none; }
}

/* Field-error rollup. Shown above the editor body when the user
 * attempts to save with invalid fields. The danger-tinted panel
 * surfaces every problem in one place and lets the user jump to
 * each field via underlined anchors. Auto-hides when the user fixes
 * the issues (validation computed re-evaluates). */
.wp-editor__errors {
  padding: var(--wp-space-4) var(--wp-space-5);
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 32%, transparent);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-sm);
}
.wp-editor__errors-title { font-weight: 600; margin-bottom: var(--wp-space-3); }
.wp-editor__errors ul { margin: 0; padding-left: var(--wp-space-5); }
.wp-editor__errors li { margin-bottom: var(--wp-space-2); }
.wp-editor__errors a { color: var(--wp-text); text-decoration: underline; }
.wp-editor__errors-sep { color: var(--wp-text-muted); }
</style>
