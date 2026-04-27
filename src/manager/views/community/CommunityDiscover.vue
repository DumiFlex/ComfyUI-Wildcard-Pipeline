<script setup lang="ts">
/**
 * Community → Discover screen.
 *
 * Wraps the search store, exposes filter / sort / kind / verified / NSFW
 * toggles, and renders a featured strip + card grid. UI-only, mock-backed.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Checkbox from "primevue/checkbox";
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
          label="My profile"
          icon="pi pi-user"
          severity="secondary"
          outlined
          @click="router.push('/community/profile')"
        />
        <Button
          label="Publish"
          icon="pi pi-upload"
          @click="router.push('/community/upload')"
        />
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
            <span class="wp-comm-card__kind">
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
      <span class="wp-comm-filters__search p-input-icon-left">
        <i class="pi pi-search" />
        <InputText
          v-model="q"
          placeholder="Search modules, tags, authors..."
          class="w-full"
          aria-label="Search community"
        />
      </span>
      <Select
        v-model="kind"
        :options="KIND_OPTIONS"
        option-label="label"
        option-value="value"
        placeholder="Kind"
        class="w-40"
        aria-label="Filter by kind"
      />
      <Select
        v-model="sort"
        :options="SORT_OPTIONS"
        option-label="label"
        option-value="value"
        placeholder="Sort"
        class="w-44"
        aria-label="Sort modules"
      />
      <label class="wp-comm-filters__toggle">
        <Checkbox v-model="verifiedOnly" :binary="true" /> Verified only
      </label>
      <label class="wp-comm-filters__toggle">
        <Checkbox v-model="compatibleOnly" :binary="true" /> Compatible (engine {{ store.engineVersion }})
      </label>
      <label class="wp-comm-filters__toggle wp-comm-filters__toggle--nsfw">
        <Checkbox v-model="includeNsfw" :binary="true" /> Show 18+
      </label>
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
        <div class="wp-comm-card__hero" style="background: var(--wp-bg-2)" />
        <div class="wp-comm-card__body">
          <div class="wp-comm-card__title">Loading...</div>
        </div>
      </article>
    </div>
    <div v-else-if="store.feed.length === 0" class="wp-comm-empty">
      <i class="pi pi-search wp-comm-empty__icon" aria-hidden="true" />
      <h3>{{ q ? `No matches for "${q}"` : "Nothing to show" }}</h3>
      <p>Try clearing filters or broaden your search.</p>
      <Button
        class="mt-3"
        label="Clear filters"
        icon="pi pi-filter-slash"
        severity="secondary"
        outlined
        @click="clearFilters"
      />
    </div>
    <div v-else class="wp-comm-grid">
      <CommunityCard v-for="atom in store.feed" :key="atom.id" :atom="atom" />
    </div>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

.w-full { width: 100%; }
.w-40   { width: 160px; }
.w-44   { width: 180px; }
.mt-3   { margin-top: 12px; }
</style>
