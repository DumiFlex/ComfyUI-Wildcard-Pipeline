<script setup lang="ts">
import SearchInput from "@/kit/SearchInput.vue";
import Kbd from "@/kit/Kbd.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type Component } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { DOC_GROUPS, pagesByGroup, findPage, searchPages, toneVar, type DocGroupId, type DocPageMeta } from "../docs/registry";
import { DOC_OUTLINE, createOutline, type DocOutlineEntry } from "../docs/outline";
import DocSearchResults from "../components/docs/DocSearchResults.vue";
import { GITHUB_WIKI } from "../config/links";
import { useAiConfig } from "../composables/useAiConfig";
import { useAiChat } from "../composables/useAiChat";
import { explainPrompt, selectedText } from "../composables/useSelectionAsk";
import { docExplainPrompt } from "../utils/chat-starters";

const props = defineProps<{ page?: string }>();

const ai = useAiConfig();
const chat = useAiChat();

/** Open the assistant chat with a question about this page (or the text the
 *  user selected on it), ready to send or edit. The question names the page,
 *  so it still asks about this one when the user moves on before sending. */
function askAssistant(): void {
  const picked = selectedText();
  const title = activeMeta.value?.title;
  chat.input.value = picked ? explainPrompt(picked)
    : title ? docExplainPrompt(title) : "Explain this page in simpler words";
  chat.open.value = true;
}

const contentEl = ref<HTMLElement | null>(null);
const route = useRoute();
const router = useRouter();
const query = ref("");
// Full-text results take the content pane while the box holds 2+ letters;
// the nav lists the pages named like it and the pages with a hit.
const searching = computed(() => query.value.trim().length >= 2);
const activeMeta = computed(() => findPage(props.page) ?? findPage("introduction"));
/** Pages with a full-text hit for the current query (the results pane says). */
const hitPages = shallowRef<Set<string>>(new Set());
const visibleIds = computed(() => new Set([
  ...searchPages(query.value).map((p) => p.id),
  ...(searching.value ? hitPages.value : []),
]));

function groupPages(g: DocGroupId) {
  return pagesByGroup(g).filter((p) => visibleIds.value.has(p.id));
}

const searchEl = ref<InstanceType<typeof SearchInput> | null>(null);
const resultsEl = ref<InstanceType<typeof DocSearchResults> | null>(null);
function openFirstHit(): void {
  const to = resultsEl.value?.first();
  if (!to) return;
  query.value = "";
  void router.push(to);
}
// "/" jumps to the search box, as on most docs sites.
function onKey(ev: KeyboardEvent): void {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = ev.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  ev.preventDefault();
  searchEl.value?.focus();
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

/** Every page in nav order, for Previous / Next. */
const ordered = computed<DocPageMeta[]>(() => DOC_GROUPS.flatMap((g) => pagesByGroup(g.id)));
const prevPage = computed(() => {
  const i = ordered.value.findIndex((p) => p.id === activeMeta.value?.id);
  return i > 0 ? ordered.value[i - 1] : null;
});
const nextPage = computed(() => {
  const i = ordered.value.findIndex((p) => p.id === activeMeta.value?.id);
  return i >= 0 && i < ordered.value.length - 1 ? ordered.value[i + 1] : null;
});
const groupLabel = (p: DocPageMeta): string => DOC_GROUPS.find((g) => g.id === p.group)?.label ?? "";

// "On this page": DocSections add themselves; the list shows from 3 sections
// up, beside the page when the content pane is wide enough.
const sections = shallowRef<DocOutlineEntry[]>([]);
provide(DOC_OUTLINE, createOutline((e) => { sections.value = e; }));
const activeSection = ref("");
const wide = ref(false);
const OUTLINE_MIN_WIDTH = 1120;
const showOutline = computed(() => wide.value && !searching.value && sections.value.length >= 3);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!contentEl.value || typeof ResizeObserver === "undefined") return;
  ro = new ResizeObserver(([e]) => { wide.value = e.contentRect.width >= OUTLINE_MIN_WIDTH; });
  ro.observe(contentEl.value);
});
onBeforeUnmount(() => ro?.disconnect());

/** The last section whose top has scrolled past the top of the pane. */
function trackSection(): void {
  const root = contentEl.value;
  if (!root || !sections.value.length) return;
  const top = root.getBoundingClientRect().top + 48;
  let current = sections.value[0].id;
  for (const s of sections.value) {
    const el = document.getElementById(s.id);
    if (el && el.getBoundingClientRect().top <= top) current = s.id;
  }
  // At the very bottom the last short sections never reach the top: pick the last.
  if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = sections.value[sections.value.length - 1].id;
  activeSection.value = current;
}

/** Scroll to the section the URL names (`#s-…`), else to the top. */
async function scrollToHash(): Promise<void> {
  await nextTick();
  const id = route.hash.replace(/^#/, "");
  const root = contentEl.value;
  const el = id ? document.getElementById(decodeURIComponent(id)) : null;
  // Scroll only the content pane: scrollIntoView would also move the
  // manager's own layout when anything around it can scroll.
  const top = el && root?.contains(el)
    ? root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - 16
    : 0;
  root?.scrollTo?.({ top });
  trackSection();
}
watch(() => route.hash, () => { void scrollToHash(); });
// Results start at the top; closing them goes back to the page's section.
watch(searching, (on) => {
  if (on) contentEl.value?.scrollTo?.({ top: 0 });
  else void scrollToHash();
});

// Resolved synchronous component. Call the raw loader (stored on the registry
// entry as `.loader`) so flushPromises() fully settles it in tests without
// needing Suspense. In production the Promise resolves on first render with no
// visible difference (the shallowRef update triggers Vue's reactivity).
const resolvedComponent = shallowRef<Component | null>(null);
watch(
  activeMeta,
  async (meta) => {
    if (!meta) { resolvedComponent.value = null; return; }
    const mod = await meta.loader();
    resolvedComponent.value = mod.default;
    // The view persists across /docs/:page changes (shared layoutKey), so the
    // content pane is NOT remounted between pages — reset its scroll to the top
    // (or the linked section) on each switch. The nav's scroll is intentionally
    // left untouched so the user keeps their place in the page list.
    await nextTick();
    await scrollToHash();
  },
  { immediate: true },
);
</script>

<template>
  <div class="wp-doc">
    <aside class="wp-doc__nav">
      <SearchInput
        ref="searchEl"
        v-model="query"
        class="wp-doc__search"
        data-test="doc-search"
        placeholder="Search docs…"
        aria-label="Search documentation"
        @keydown.enter.prevent="openFirstHit"
      />
      <p class="wp-doc__search-hint" aria-hidden="true">
        <template v-if="searching"><Kbd keys="Enter" size="sm" /> opens the first result</template>
        <template v-else><Kbd keys="/" size="sm" /> searches every page</template>
      </p>
      <template v-for="g in DOC_GROUPS" :key="g.id">
        <div v-if="groupPages(g.id).length" class="wp-doc__grp">{{ g.label }}</div>
        <RouterLink
          v-for="p in groupPages(g.id)"
          :key="p.id"
          :to="`/docs/${p.id}`"
          class="wp-doc__link"
          :class="{ 'is-active': p.id === activeMeta?.id }"
          :style="{ '--doc-tone': toneVar(p.tone) }"
        >
          <i
            :class="[p.icon, 'wp-doc__link-icon', { 'wp-doc__link-icon--toned': p.tone !== 'neutral' }]"
            aria-hidden="true"
          />
          {{ p.title }}
        </RouterLink>
      </template>

      <!-- The wiki covers the same ground as these pages but on GitHub, so it
           belongs at the foot of this nav rather than as its own sidebar tab
           sitting directly above View Source. -->
      <a
        :href="GITHUB_WIKI"
        target="_blank"
        rel="noopener noreferrer"
        class="wp-doc__link wp-doc__link--external"
        data-test="doc-wiki-link"
      >
        <i class="pi pi-external-link wp-doc__link-icon" aria-hidden="true" />
        Wiki on GitHub
      </a>
    </aside>
    <main ref="contentEl" class="wp-doc__content" @scroll.passive="trackSection">
      <!-- Pinned to the top right of the page as it scrolls. -->
      <div v-if="ai.ready.value" class="wp-doc__askbar">
        <button
          type="button"
          class="wp-doc__ask"
          data-test="doc-ask-ai"
          title="Ask about this page. Select text on it first to ask about just that part"
          @mousedown.prevent
          @click="askAssistant"
        >
          <i class="pi pi-microchip-ai" aria-hidden="true" /> Ask about this page
        </button>
      </div>
      <DocSearchResults v-if="searching" ref="resultsEl" :query="query" @open="query = ''" @pages="hitPages = $event" />
      <div v-show="!searching" class="wp-doc__page" :data-outline="showOutline || undefined">
        <div class="wp-doc__main">
          <component :is="resolvedComponent" v-if="resolvedComponent" />
          <nav v-if="prevPage || nextPage" class="wp-doc__pager" aria-label="Previous and next page">
            <RouterLink v-if="prevPage" :to="`/docs/${prevPage.id}`" class="wp-doc__step" data-dir="prev" data-test="doc-prev">
              <span class="wp-doc__step-dir"><i class="pi pi-arrow-left" aria-hidden="true" /> Previous</span>
              <span class="wp-doc__step-title">{{ prevPage.title }}</span>
              <span class="wp-doc__step-group">{{ groupLabel(prevPage) }}</span>
            </RouterLink>
            <RouterLink v-if="nextPage" :to="`/docs/${nextPage.id}`" class="wp-doc__step" data-dir="next" data-test="doc-next">
              <span class="wp-doc__step-dir">Next <i class="pi pi-arrow-right" aria-hidden="true" /></span>
              <span class="wp-doc__step-title">{{ nextPage.title }}</span>
              <span class="wp-doc__step-group">{{ groupLabel(nextPage) }}</span>
            </RouterLink>
          </nav>
        </div>
        <nav v-if="showOutline" class="wp-doc__outline" aria-label="On this page" data-test="doc-outline">
          <p class="wp-doc__outline-head">On this page</p>
          <RouterLink
            v-for="sec in sections"
            :key="sec.id"
            :to="{ hash: `#${sec.id}` }"
            replace
            class="wp-doc__outline-link"
            :class="{ 'is-active': sec.id === activeSection }"
            :aria-current="sec.id === activeSection ? 'location' : undefined"
          >{{ sec.title }}</RouterLink>
        </nav>
      </div>
    </main>
  </div>
</template>

<style scoped>
.wp-doc {
  display: grid;
  grid-template-columns: 236px 1fr;
  min-height: 0;
  height: 100%;
}
.wp-doc__nav {
  border-right: 1px solid var(--wp-border);
  background: var(--wp-bg);
  overflow-y: auto;
  padding: 14px 10px 28px;
}
.wp-doc__search { margin-bottom: 14px; }
/* Sticky, and no height of its own, so the button floats over the crumb row
   at the top right instead of pushing the page down. */
.wp-doc__askbar {
  position: sticky;
  top: 10px;
  z-index: 3;
  height: 0;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}
.wp-doc__ask {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 11px;
  margin-top: -6px;
  background: color-mix(in oklab, var(--wp-accent-500) 18%, var(--wp-bg-1));
  box-shadow: var(--wp-shadow-md);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: min(7px, var(--wp-radius-cap, 999px));
  color: var(--wp-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.wp-doc__ask:hover { background: color-mix(in oklab, var(--wp-accent-500) 28%, var(--wp-bg-1)); }
.wp-doc__ask:focus-visible { outline: 2px solid var(--wp-accent-500); outline-offset: 2px; }
.wp-doc__grp {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  padding: 12px 8px 5px;
}
.wp-doc__link {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 9px;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  color: var(--wp-text-muted);
  text-decoration: none;
  font-size: 12.5px;
}
.wp-doc__link:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
/* Off-app destination — separated from the in-app page list so it doesn't read
   as another doc page. */
.wp-doc__link--external {
  margin-top: 14px;
  padding-top: 11px;
  border-top: 1px solid var(--wp-border);
  border-radius: 0;
  color: var(--wp-text-dim);
}
.wp-doc__link.is-active {
  background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent);
  color: var(--wp-text);
  font-weight: 500;
}
.wp-doc__link-icon {
  width: 15px;
  font-size: 12.5px;
  color: var(--wp-text-dim);
  text-align: center;
  flex: 0 0 15px;
}
.wp-doc__link-icon--toned { color: var(--doc-tone); }
.wp-doc__link.is-active .wp-doc__link-icon { color: inherit; }
.wp-doc__content {
  overflow-y: auto;
  padding: 26px 34px 60px;
}
.wp-doc__search-hint {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  margin: -8px 4px 10px; color: var(--wp-text-dim); font-size: 11px;
}
.wp-doc__page { display: grid; grid-template-columns: minmax(0, 860px); gap: 40px; }
.wp-doc__page[data-outline] { grid-template-columns: minmax(0, 860px) 200px; }
.wp-doc__main { min-width: 0; display: flex; flex-direction: column; gap: 40px; }
/* Sticks beside the page as it scrolls; its own scroll if the list is long. */
.wp-doc__outline {
  position: sticky; top: 44px; align-self: start;
  max-height: calc(100vh - 160px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 2px;
  padding-left: 12px; border-left: 1px solid var(--wp-border);
}
.wp-doc__outline-head {
  margin: 0 0 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-doc__outline-link {
  padding: 3px 0; color: var(--wp-text-muted); text-decoration: none; font-size: 12px; line-height: 1.4;
}
.wp-doc__outline-link:hover { color: var(--wp-text); }
.wp-doc__outline-link.is-active { color: var(--wp-accent-text); font-weight: 500; }
.wp-doc__outline-link:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); border-radius: var(--wp-radius-sm); }
.wp-doc__pager { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 20px; border-top: 1px solid var(--wp-border); }
.wp-doc__step {
  display: flex; flex-direction: column; gap: 2px; padding: 12px 14px;
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-1);
  color: var(--wp-text); text-decoration: none;
}
.wp-doc__step[data-dir="next"] { grid-column: 2; text-align: right; align-items: flex-end; }
.wp-doc__step:hover { border-color: var(--wp-border-strong); background: var(--wp-bg-2); }
.wp-doc__step:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-doc__step-dir { display: inline-flex; align-items: center; gap: 6px; color: var(--wp-text-dim); font-size: 11px; }
.wp-doc__step-dir .pi { font-size: 10px; }
.wp-doc__step-title { font-size: 13.5px; font-weight: 600; }
.wp-doc__step-group { color: var(--wp-text-muted); font-size: 11.5px; }
</style>
