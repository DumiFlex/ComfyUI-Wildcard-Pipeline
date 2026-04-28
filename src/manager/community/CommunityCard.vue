<script setup lang="ts">
/**
 * Community module / bundle card.
 *
 * Used by Discover grid, Profile tabs, and the search results. Click opens
 * the detail screen; star button is local to the card (delegated to store).
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useCommunityStore } from "../stores/communityStore";
import { engineSatisfies } from "./mockApi";
import { fmtNumber, relativeTime, KIND_ICON, KIND_LABEL } from "./format";
import type { CommunityAtom } from "./types";

const props = defineProps<{ atom: CommunityAtom }>();
const router = useRouter();
const store = useCommunityStore();

const installed = computed(() => store.installed.has(props.atom.id));
const starred = computed(() => store.starred.has(props.atom.id));
const compatible = computed(() =>
  engineSatisfies(store.engineVersion, props.atom.engine_min_version || "0"),
);
const kindKey = computed(() =>
  props.atom.type === "bundle" ? "bundle" : props.atom.type,
);

function openDetail() {
  router.push({ name: "community-detail", params: { id: props.atom.id } });
}

async function onStar(event: Event) {
  event.stopPropagation();
  if (!store.currentUser) return;
  await store.toggleStar(props.atom.id);
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openDetail();
  }
}
</script>

<template>
  <article
    class="wp-comm-card"
    role="button"
    tabindex="0"
    :aria-label="`Open ${atom.name}`"
    @click="openDetail"
    @keydown="onKey"
  >
    <div class="wp-comm-card__hero" :style="{ background: atom.hero }">
      <span class="wp-comm-card__kind">
        <i :class="['pi', KIND_ICON[kindKey]]" aria-hidden="true" />
        {{ KIND_LABEL[kindKey] }}
      </span>
      <span class="wp-comm-card__hero-right">
        <span v-if="atom.nsfw" class="wp-comm-card__nsfw">18+</span>
        <span
          v-if="!compatible"
          class="wp-comm-card__incompat"
          :title="`Needs engine >= ${atom.engine_min_version}`"
        >
          engine ≥ {{ atom.engine_min_version }}
        </span>
      </span>
    </div>
    <div class="wp-comm-card__body">
      <div class="wp-comm-card__title-row">
        <h3 class="wp-comm-card__title">{{ atom.name }}</h3>
        <button
          type="button"
          class="wp-comm-card__star"
          :data-on="starred"
          :aria-label="starred ? 'Unstar module' : 'Star module'"
          :title="starred ? 'Unstar' : 'Star'"
          @click="onStar"
        >
          <i :class="['pi', starred ? 'pi-star-fill' : 'pi-star']" aria-hidden="true" />
        </button>
      </div>
      <p class="wp-comm-card__tagline">{{ atom.tagline }}</p>
      <div class="wp-comm-card__author">
        <span
          class="wp-comm-card__avatar"
          :style="{ backgroundImage: `url(${atom.author.avatar_url})` }"
          aria-hidden="true"
        />
        <span>@{{ atom.author.login }}</span>
        <i v-if="atom.author.verified" class="pi pi-verified" aria-hidden="true" />
        <span> · {{ relativeTime(atom.updated_at) }}</span>
      </div>
      <div class="wp-comm-card__stats">
        <span title="Downloads"><i class="pi pi-download" />{{ fmtNumber(atom.downloads) }}</span>
        <span title="Stars"><i class="pi pi-star-fill" />{{ fmtNumber(atom.stars) }}</span>
        <span title="Rating"><i class="pi pi-star" />{{ atom.rating.toFixed(1) }}</span>
      </div>
      <div v-if="atom.tags.length" class="wp-comm-card__tags">
        <span v-for="tag in atom.tags.slice(0, 4)" :key="tag" class="wp-comm-card__tag">
          {{ tag }}
        </span>
      </div>
      <div v-if="installed" class="wp-comm-card__installed">
        <i class="pi pi-check-circle" aria-hidden="true" /> Installed
      </div>
    </div>
  </article>
</template>

<style scoped>
@import "./community.css";
</style>
