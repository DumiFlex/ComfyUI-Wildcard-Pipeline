<script setup lang="ts">
/**
 * Community → Discover screen.
 *
 * Wraps the search store, exposes filter / sort / kind / verified / NSFW
 * toggles, and renders a featured strip + card grid. UI-only, mock-backed.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "../../components/ui/Button.vue";
import Input from "../../components/ui/Input.vue";
import Select from "../../components/ui/Select.vue";
import { useCommunityStore } from "../../stores/communityStore";
import CommunityCard from "../../community/CommunityCard.vue";
import { KIND_ICON, KIND_LABEL, fmtNumber } from "../../community/format";
import { getAllTags } from "../../community/mockApi";
import type { CommunitySortKey } from "../../community/types";

const router = useRouter();
const store = useCommunityStore();

const q = ref("");
const kind = ref<string>("all");
const tag = ref<string | null>(null);
const sort = ref<CommunitySortKey>("trending");
const verifiedOnly = ref(false);
const includeNsfw = ref(false);
const compatibleOnly = ref(true);

const KIND_OPTIONS = [
  { label: "All kinds",   value: "all" },
  { label: "Wildcards",   value: "wildcard" },
  { label: "Fixed Values",value: "fixed_values" },
  { label: "Combines",    value: "combine" },
  { label: "Derivations", value: "derivation" },
  { label: "Constraints", value: "constraint" },
  { label: "Pipelines",   value: "pipeline" },
  { label: "Packs",       value: "bundle" },
];

const SORT_OPTIONS: { label: string; value: CommunitySortKey }[] = [
  { label: "Trending",         value: "trending" },
  { label: "Recently updated", value: "recent" },
  { label: "Most downloaded",  value: "downloads" },
  { label: "Most starred",     value: "stars" },
  { label: "Highest rated",    value: "rating" },
];

const TAG_RAIL = getAllTags().slice(0, 14);

const featured = computed(() => store.featured);

async function reload() {
  await store.search({
    q: q.value,
    kind: kind.value as never,
    tag: tag.value,
    sort: sort.value,
    verified_only: verifiedOnly.value,
    include_nsfw: includeNsfw.value,
    compatible_only: compatibleOnly.value,
  });
}

watch(
  [q, kind, tag, sort, verifiedOnly, includeNsfw, compatibleOnly],
  () => {
    reload();
  },
  { deep: true },
);

function clearFilters() {
  q.value = "";
  kind.value = "all";
  tag.value = null;
  sort.value = "trending";
  verifiedOnly.value = false;
}

function openDetail(id: string) {
  router.push({ name: "community-detail", params: { id } });
}

onMounted(async () => {
  await Promise.all([store.loadFeatured(), reload()]);
  if (store.apiStatus === "offline") {
    router.replace({ name: "community-offline" });
  }
});
</script>

<template>
  <div class="wp-comm-page">
    <header class="wp-comm-page__header">
      <div>
        <h1 class="wp-comm-page__title">Community</h1>
        <p class="wp-comm-page__subtitle">
          Discover, install, and share modules with the rest of the pipeline.
        </p>
      </div>
      <div class="wp-comm-page__actions">
        <Button
          variant="outline"
          icon="user"
          @click="router.push('/community/profile')"
        >My profile</Button>
        <Button
          variant="primary"
          icon="upload"
          @click="router.push('/community/upload')"
        >Publish</Button>
      </div>
    </header>

    <!-- Featured strip -->
    <section v-if="featured.length" class="wp-comm-featured">
      <div class="wp-comm-featured__head">
        <h2 class="wp-comm-featured__label">
          <i class="pi pi-bookmark-fill" aria-hidden="true" /> Featured this week
        </h2>
        <span class="wp-comm-featured__hint">Curated by the team</span>
      </div>
      <div class="wp-comm-featured__row">
        <button
          v-for="atom in featured.slice(0, 3)"
          :key="atom.id"
          type="button"
          class="wp-comm-feat"
          :style="{ background: atom.hero }"
          @click="openDetail(atom.id)"
        >
          <div class="wp-comm-feat__inner">
            <span class="wp-comm-feat__kind">
              <i :class="['pi', KIND_ICON[atom.type === 'bundle' ? 'bundle' : atom.type]]" aria-hidden="true" />
              {{ KIND_LABEL[atom.type === "bundle" ? "bundle" : atom.type] }}
            </span>
            <h3>{{ atom.name }}</h3>
            <p>{{ atom.tagline }}</p>
            <div class="wp-comm-feat__stats">
              <span><i class="pi pi-download" />{{ fmtNumber(atom.downloads) }}</span>
              <span><i class="pi pi-star-fill" />{{ fmtNumber(atom.stars) }}</span>
              <span><i class="pi pi-star" />{{ atom.rating.toFixed(1) }}</span>
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- Filter bar -->
    <section class="wp-comm-filters">
      <div class="wp-comm-filters__search">
        <Input
          v-model="q"
          icon="search"
          placeholder="Search modules, tags, authors..."
          aria-label="Search community"
        />
      </div>
      <div class="wp-comm-filter-select wp-comm-filter-select--kind">
        <Select
          v-model="kind"
          :options="KIND_OPTIONS"
          placeholder="Kind"
          aria-label="Filter by kind"
        />
      </div>
      <div class="wp-comm-filter-select wp-comm-filter-select--sort">
        <Select
          v-model="sort"
          :options="SORT_OPTIONS"
          placeholder="Sort"
          aria-label="Sort modules"
        />
      </div>
      <button
        type="button"
        class="wp-comm-filters__toggle"
        :data-active="verifiedOnly ? 'true' : 'false'"
        @click="verifiedOnly = !verifiedOnly"
      >
        <span class="wp-check" :data-checked="verifiedOnly ? 'true' : 'false'" aria-hidden="true">
          <svg v-if="verifiedOnly" viewBox="0 0 12 12" fill="none" style="display:block">
            <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        Verified only
      </button>
      <button
        type="button"
        class="wp-comm-filters__toggle"
        :data-active="compatibleOnly ? 'true' : 'false'"
        @click="compatibleOnly = !compatibleOnly"
      >
        <span class="wp-check" :data-checked="compatibleOnly ? 'true' : 'false'" aria-hidden="true">
          <svg v-if="compatibleOnly" viewBox="0 0 12 12" fill="none" style="display:block">
            <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        Compatible (engine {{ store.engineVersion }})
      </button>
      <button
        type="button"
        class="wp-comm-filters__toggle wp-comm-filters__toggle--nsfw"
        :data-active="includeNsfw ? 'true' : 'false'"
        @click="includeNsfw = !includeNsfw"
      >
        <span class="wp-check" :data-checked="includeNsfw ? 'true' : 'false'" aria-hidden="true">
          <svg v-if="includeNsfw" viewBox="0 0 12 12" fill="none" style="display:block">
            <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        Show 18+
      </button>
    </section>

    <!-- Tag rail -->
    <div class="wp-comm-tagrail" role="group" aria-label="Filter by tag">
      <button
        type="button"
        class="wp-comm-chip-btn"
        :data-active="tag === null"
        @click="tag = null"
      >All tags</button>
      <button
        v-for="t in TAG_RAIL"
        :key="t"
        type="button"
        class="wp-comm-chip-btn"
        :data-active="tag === t"
        @click="tag = tag === t ? null : t"
      >{{ t }}</button>
    </div>

    <!-- Body -->
    <div v-if="store.loading" class="wp-comm-grid" aria-busy="true">
      <article v-for="n in 6" :key="n" class="wp-comm-card">
        <div class="wp-comm-card__hero wp-comm-card__hero--skeleton" />
        <div class="wp-comm-card__body">
          <div class="wp-comm-card__title">Loading...</div>
        </div>
      </article>
    </div>
    <div v-else-if="store.feed.length === 0" class="wp-empty wp-empty--card">
      <i class="pi pi-search wp-empty__icon" aria-hidden="true" />
      <h3>{{ q ? `No matches for "${q}"` : "Nothing to show" }}</h3>
      <p>Try clearing filters or broaden your search.</p>
      <Button
        class="wp-empty__cta"
        variant="outline"
        icon="filter-slash"
        @click="clearFilters"
      >Clear filters</Button>
    </div>
    <div v-else class="wp-comm-grid">
      <CommunityCard v-for="atom in store.feed" :key="atom.id" :atom="atom" />
    </div>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

/* Filter-bar select widths. */
.wp-comm-filter-select--kind { width: 160px; }
.wp-comm-filter-select--sort { width: 180px; }

/* Toggle buttons — pill-shaped, cursor pointer, match prototype's wp-comm-toggle. */
.wp-comm-filters__toggle {
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  border: 1px solid transparent;
}
.wp-comm-filters__toggle:hover {
  background: var(--wp-bg-4);
}
.wp-comm-filters__toggle[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 32%, transparent);
  color: var(--wp-accent-text);
}

/* Empty-state CTA spacer. */
.wp-empty__cta { margin-top: 12px; }

/* Loading skeleton fallback for the card hero gradient. */
.wp-comm-card__hero--skeleton { background: var(--wp-bg-2); }
</style>
