<script setup lang="ts">
/**
 * A single, quiet request for a GitHub star.
 *
 * It is a favour, so it behaves like one. It appears at most once, it never
 * blocks anything, "Don't ask again" is permanent, and it only shows up after
 * someone has kept coming back to a library they are actually building — see
 * `engagementStore` for why that is the trigger rather than "created N
 * modules" or "ran the starter".
 *
 * PLACEMENT AND WEIGHT
 *
 * It renders at the BOTTOM of the dashboard, below the content someone opened
 * the app to use. Above the hero it was the first thing on the page — louder
 * than the product's own welcome, which is the layout of an ad rather than of
 * an aside. The eligibility rule already selects a returning user, so it will
 * be found without being put in the way.
 *
 * It is built from the same `Card` / `Button` / `Icon` primitives as the rest
 * of the manager, in the manager's accent, so it reads as part of the app.
 * The earlier version styled itself from scratch in `--wp-node` — the CANVAS
 * node palette, teal — which is the graph's colour language, not the SPA's.
 *
 * The star count is deliberately not shown. Social proof cuts both ways, and
 * at a low number it argues against starring.
 */
import { computed } from "vue";
import Button from "./ui/Button.vue";
import Icon from "./ui/Icon.vue";
import { GITHUB_REPO } from "../config/links";
import { useEngagementStore, measureSubstance } from "../stores/engagementStore";
import { useModuleStore } from "../stores/moduleStore";

const engagement = useEngagementStore();
const moduleStore = useModuleStore();

const substance = computed(() => measureSubstance(moduleStore.catalog));
const visible = computed(() => engagement.shouldAskForStar(substance.value));

function star(): void {
  // Mark before opening: if the tab swap loses us, the promise not to ask
  // again still holds.
  engagement.setStarState("done");
  window.open(GITHUB_REPO, "_blank", "noopener");
}
</script>

<template>
  <aside v-if="visible" class="wp-star" data-test="star-prompt">
    <span class="wp-star__icon"><Icon name="pi-star" /></span>
    <div class="wp-star__body">
      <p class="wp-star__title">Enjoying Wildcard Pipeline?</p>
      <p class="wp-star__sub">
        A star on GitHub is the main way other people find it — it takes a
        second and costs nothing.
      </p>
    </div>
    <div class="wp-star__actions">
      <Button variant="outline" size="sm" icon="pi-star" data-test="star-prompt-go" @click="star">
        Star on GitHub
      </Button>
      <Button
        variant="ghost"
        size="sm"
        data-test="star-prompt-later"
        @click="engagement.setStarState('later')"
      >Maybe later</Button>
      <Button
        variant="ghost"
        size="sm"
        data-test="star-prompt-never"
        @click="engagement.setStarState('never')"
      >Don't ask again</Button>
    </div>
  </aside>
</template>

<style scoped>
/* Mirrors the quick-create bar's shell (bg-1 + hairline + radius-lg) so it
 * sits in the dashboard's existing rhythm rather than introducing a new
 * surface. The only departure is a faint accent wash, which is what marks it
 * as an aside rather than another tool strip. */
.wp-star {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-5);
  background:
    linear-gradient(
      90deg,
      color-mix(in oklab, var(--wp-accent-500) 7%, transparent),
      transparent 60%
    ),
    var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
}
.wp-star__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent);
}
.wp-star__body { flex: 1 1 auto; min-width: 0; }
.wp-star__title {
  margin: 0;
  font-size: var(--wp-text-sm);
  font-weight: 600;
  line-height: 1.4;
  color: var(--wp-text);
}
.wp-star__sub {
  margin: 1px 0 0;
  font-size: var(--wp-text-xs);
  line-height: 1.5;
  color: var(--wp-text-muted);
}
.wp-star__actions {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  flex: none;
}
@media (max-width: 760px) {
  .wp-star { flex-wrap: wrap; }
  .wp-star__actions { width: 100%; justify-content: flex-end; }
}
</style>
