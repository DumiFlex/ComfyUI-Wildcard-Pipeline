<script setup lang="ts">
/**
 * A community post as a card: type chip, NSFW / Featured / recommended
 * badges, version, `owner/name` slug, bundle contents, description, up to
 * four tags, then stars, downloads and when it was updated. A coloured stripe
 * on top says the type; a featured card is tinted, a deleted one faded.
 *
 * The whole card is one link. It renders an `<a>` by default; pass the app's
 * router link as `as` (and its `to`) so the kit never imports a router:
 *
 *   <PostCard :as="RouterLink" :to="`/p/${post.slug}`" :post="card(post)" />
 *   <PostCard href="/p/dumi/warm" :post="…" />
 *   <PostCard as="button" type="button" :post="…" @click="open" />
 */
import { computed, type Component } from "vue";
import BundleMeta from "./BundleMeta.vue";
import Icon from "./Icon.vue";
import KindChip, { type KindChipSubtype } from "./KindChip.vue";
import RatingBadge from "./RatingBadge.vue";
import RelativeDate from "./RelativeDate.vue";

export interface PostCardData {
  /** `owner/name`. */
  slug: string;
  kind: "module" | "bundle";
  subtype?: KindChipSubtype | "bundle" | null | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  stars: number;
  downloads: number;
  /** ISO time of the last update. */
  updatedAt: string;
  rating?: "sfw" | "nsfw" | undefined;
  featured?: boolean | undefined;
  /** The latest version is marked recommended. */
  recommended?: boolean | undefined;
  /** Soft-deleted: the card fades and shows "deleted" where the version goes. */
  deleted?: boolean | undefined;
  version?: number | null | undefined;
  bundleModules?: { count: number; names: string[] } | null | undefined;
}

const props = withDefaults(defineProps<{
  post: PostCardData;
  /** The viewer starred it: the star in the footer fills. */
  starred?: boolean | undefined;
  /** Element or component for the link, e.g. the app's RouterLink. */
  as?: string | Component | undefined;
}>(), { starred: false, as: "a" });

const type = computed(() => (props.post.kind === "bundle" ? "bundle" : (props.post.subtype ?? "fixed_values")));
const owner = computed(() => props.post.slug.split("/")[0]);
const name = computed(() => props.post.slug.split("/").slice(1).join("/"));
const tags = computed(() => props.post.tags ?? []);
</script>

<template>
  <component
    :is="as"
    class="wp-post-card"
    :data-type="type"
    :data-featured="post.featured || undefined"
    :data-deleted="post.deleted || undefined"
  >
    <div class="wp-post-card__top">
      <div class="wp-post-card__badges">
        <KindChip :kind="post.kind" :subtype="post.subtype" />
        <RatingBadge :rating="post.rating" :featured="post.featured" />
        <span v-if="post.recommended" class="wp-chip wp-chip--success">
          <span class="wp-chip__dot" />recommended
        </span>
      </div>
      <span v-if="post.deleted" class="wp-chip wp-chip--danger"><Icon name="trash" :size="10" />deleted</span>
      <span v-else class="wp-chip">v{{ post.version ?? 1 }}</span>
    </div>

    <div class="wp-post-card__slug">
      <span class="wp-post-card__owner">{{ owner }}</span><span class="wp-post-card__sep">/</span>{{ name }}
    </div>

    <BundleMeta
      v-if="post.kind === 'bundle' && post.bundleModules"
      :count="post.bundleModules.count"
      :names="post.bundleModules.names"
    />

    <p v-if="post.description" class="wp-post-card__desc">{{ post.description }}</p>

    <div v-if="tags.length" class="wp-post-card__tags">
      <span v-for="t in tags.slice(0, 4)" :key="t" class="wp-chip">{{ t }}</span>
      <span v-if="tags.length > 4" class="wp-chip">+{{ tags.length - 4 }}</span>
    </div>

    <div class="wp-post-card__foot">
      <span class="wp-post-card__stat" :data-active="starred || undefined">
        <Icon :name="starred ? 'star-fill' : 'star'" :size="11" />{{ post.stars.toLocaleString() }}
      </span>
      <span class="wp-post-card__stat">
        <Icon name="download" :size="11" />{{ post.downloads.toLocaleString() }}
      </span>
      <RelativeDate class="wp-post-card__when" :value="post.updatedAt" />
    </div>
  </component>
</template>

<style scoped>
.wp-post-card {
  --post-card-c: var(--wp-text-dim);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 20px 20px 18px;
  overflow: hidden;
  break-inside: avoid;
  /* The page spaces its cards (a grid gap or margins); one set here would
     beat the page's rule, since scoped styles win ties. */
  font: inherit;
  color: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: min(12px, var(--wp-radius-cap, 999px));
  transition: transform var(--wp-motion-quick) ease, border-color var(--wp-motion-quick) ease, box-shadow var(--wp-motion-quick) ease;
}
.wp-post-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  opacity: 0.85;
  background: linear-gradient(90deg, var(--post-card-c), color-mix(in oklab, var(--post-card-c) 50%, transparent));
}
.wp-post-card[data-type="fixed_values"] { --post-card-c: var(--wp-kind-fixed); }
.wp-post-card[data-type="combine"] { --post-card-c: var(--wp-kind-combine); }
.wp-post-card[data-type="wildcard"] { --post-card-c: var(--wp-kind-wildcard); }
.wp-post-card[data-type="constraint"] { --post-card-c: var(--wp-kind-constraint); }
.wp-post-card[data-type="derivation"] { --post-card-c: var(--wp-kind-derivation); }
.wp-post-card[data-type="bundle"] { --post-card-c: var(--wp-bundle-default); }
.wp-post-card:hover {
  transform: translateY(-3px);
  border-color: var(--wp-border-strong);
  box-shadow: var(--wp-shadow-lg);
}
.wp-post-card:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.wp-post-card:hover .wp-post-card__slug { color: var(--wp-accent-text-strong); }
.wp-post-card[data-featured] {
  background: linear-gradient(180deg, color-mix(in oklab, var(--wp-warn) 5%, var(--wp-bg-1)), var(--wp-bg-1) 60%);
  border-color: color-mix(in oklab, var(--wp-warn) 25%, var(--wp-border));
}
.wp-post-card[data-featured]:hover { border-color: color-mix(in oklab, var(--wp-warn) 40%, var(--wp-border)); }
.wp-post-card[data-deleted] { opacity: 0.62; filter: grayscale(40%); }
.wp-post-card[data-deleted]:hover { opacity: 0.85; filter: none; }

.wp-post-card__top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}
.wp-post-card__badges { display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.wp-post-card__slug {
  font-family: var(--wp-font-mono);
  font-size: 15.5px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--wp-text);
  word-break: break-word;
  transition: color var(--wp-motion-quick) ease;
}
.wp-post-card__owner { font-weight: 400; color: var(--wp-text-muted); }
.wp-post-card__sep { color: var(--wp-accent-text); }
.wp-post-card__desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 19px;
  color: var(--wp-text-muted);
  text-wrap: pretty;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.wp-post-card__tags { display: flex; flex-wrap: wrap; gap: 4px; }
.wp-post-card__tags .wp-chip { padding: 2px 8px; font-size: 11px; }
.wp-post-card__foot {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid var(--wp-border);
  font-size: 12px;
  color: var(--wp-text-muted);
}
.wp-post-card__stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--wp-font-mono);
  font-variant-numeric: tabular-nums;
}
.wp-post-card__stat :deep(.pi) { color: var(--wp-text-dim); }
.wp-post-card__stat[data-active] :deep(.pi) { color: var(--wp-accent-text); }
.wp-post-card__when { margin-left: auto; font-size: 11.5px; color: var(--wp-text-dim); }
</style>
