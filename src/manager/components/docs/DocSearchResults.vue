<script setup lang="ts">
/**
 * Full-text docs search results: page › section, a snippet with the query
 * words marked, best first. A result opens the page at that section.
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import LoadingMark from "@/kit/LoadingMark.vue";
import EmptyState from "../ui/EmptyState.vue";
import { loadDocsIndex, searchDocs, type DocHit, type IndexPage } from "../../docs/search";
import { sectionSlug } from "../../docs/outline";
import { SECTIONS } from "../settings/settings-index";

const props = defineProps<{ query: string }>();
const emit = defineEmits<{
  (e: "open"): void;
  /** The pages that have a hit, so the nav can list them. */
  (e: "pages", ids: Set<string>): void;
}>();

const pages = ref<IndexPage[] | null>(null);
const failed = ref(false);
watch(() => props.query, () => {
  if (pages.value || failed.value) return;
  loadDocsIndex().then((p) => { pages.value = p; }, () => { failed.value = true; });
}, { immediate: true });

const hits = computed(() => (pages.value ? searchDocs(pages.value, props.query) : []));
watch(hits, (h) => emit("pages", new Set(h.map((x) => x.pageId))), { immediate: true });

/** Where a hit opens: the docs page at its section, or the Settings section. */
function target(h: DocHit): string {
  if (h.pageId === "settings") {
    const sec = SECTIONS.find((s) => s.label === h.section);
    return sec ? `/settings/${sec.id}` : "/settings";
  }
  return h.section ? `/docs/${h.pageId}#s-${sectionSlug(h.section)}` : `/docs/${h.pageId}`;
}

/** The snippet cut at its marks, for <mark> without v-html. */
function parts(h: DocHit): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of h.marks) {
    if (a > at) out.push({ text: h.snippet.slice(at, a), hit: false });
    out.push({ text: h.snippet.slice(a, b), hit: true });
    at = b;
  }
  if (at < h.snippet.length) out.push({ text: h.snippet.slice(at), hit: false });
  return out;
}

defineExpose({ first: () => (hits.value[0] ? target(hits.value[0]) : null) });
</script>

<template>
  <section class="wp-doc-hits" aria-label="Search results" data-test="doc-search-results">
    <h1 class="wp-doc-hits__title">
      Results for “{{ query.trim() }}”
      <span v-if="pages" class="wp-doc-hits__count">{{ hits.length }}{{ hits.length === 30 ? "+" : "" }}</span>
    </h1>
    <LoadingMark v-if="!pages && !failed" block label="Loading the docs text" />
    <EmptyState
      v-else-if="failed"
      icon="pi-exclamation-triangle"
      variant="error"
      headline="Couldn't load the docs text"
      body="Page titles in the list on the left still filter."
    />
    <EmptyState
      v-else-if="!hits.length"
      icon="pi-search"
      variant="no-results"
      headline="Nothing matches"
      body="Try fewer or shorter words. Every word has to appear in the same section."
    />
    <ol v-else class="wp-doc-hits__list">
      <li v-for="h in hits" :key="`${h.pageId}/${h.section}`">
        <RouterLink :to="target(h)" class="wp-doc-hit" data-test="doc-search-hit" @click="emit('open')">
          <span class="wp-doc-hit__where">
            <b>{{ h.pageTitle }}</b><template v-if="h.section"><span class="wp-doc-hit__sep" aria-hidden="true">›</span>{{ h.section }}</template>
          </span>
          <span class="wp-doc-hit__snippet">
            <template v-for="(p, i) in parts(h)" :key="i"><mark v-if="p.hit" class="wp-doc-hit__mark">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
          </span>
        </RouterLink>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.wp-doc-hits { display: flex; flex-direction: column; gap: var(--wp-space-5); max-width: 860px; }
.wp-doc-hits__title { margin: 0; display: flex; align-items: center; gap: var(--wp-space-3); font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.wp-doc-hits__count {
  padding: 1px 8px; border-radius: var(--wp-radius-cap, 999px); background: var(--wp-bg-3); color: var(--wp-text-muted);
  font-size: var(--wp-text-xs); font-weight: 500; font-variant-numeric: tabular-nums;
}
.wp-doc-hits__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-2); }
.wp-doc-hit {
  display: flex; flex-direction: column; gap: 4px; padding: var(--wp-space-4) var(--wp-space-5);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md); background: var(--wp-bg-1);
  color: var(--wp-text-muted); text-decoration: none; font-size: 13px; line-height: 1.5;
}
.wp-doc-hit:hover { border-color: var(--wp-border-strong); background: var(--wp-bg-2); }
.wp-doc-hit:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-doc-hit__where { color: var(--wp-text); font-size: 12.5px; }
.wp-doc-hit__where b { font-weight: 600; }
.wp-doc-hit__sep { margin: 0 6px; color: var(--wp-text-dim); }
.wp-doc-hit__mark { background: color-mix(in oklab, var(--wp-accent-500) 26%, transparent); color: var(--wp-text); border-radius: min(2px, var(--wp-radius-cap, 999px)); padding: 0 1px; }
</style>
