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
 * Deliberately NOT a modal. The eligibility rule already selects a returning
 * user, so an inline card on the landing view will be seen without hijacking
 * the moment they opened the app to do something else. Because it fires once,
 * it can afford the accent border a permanent card could not.
 *
 * The star count is deliberately not shown. Social proof cuts both ways, and
 * at a low number it argues against starring.
 */
import { computed } from "vue";
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
  <div v-if="visible" class="wp-star" data-test="star-prompt">
    <i class="pi pi-star wp-star__icon" aria-hidden="true" />
    <div class="wp-star__body">
      <p class="wp-star__title">Still using this after a few sessions?</p>
      <p class="wp-star__sub">
        A star on GitHub is the one thing that helps other people find it.
        It takes a second and costs nothing.
      </p>
    </div>
    <div class="wp-star__actions">
      <button type="button" class="wp-star__go" data-test="star-prompt-go" @click="star">
        Star on GitHub
      </button>
      <button
        type="button"
        class="wp-star__quiet"
        data-test="star-prompt-later"
        @click="engagement.setStarState('later')"
      >Maybe later</button>
      <button
        type="button"
        class="wp-star__quiet"
        data-test="star-prompt-never"
        @click="engagement.setStarState('never')"
      >Don't ask again</button>
    </div>
  </div>
</template>

<style scoped>
.wp-star {
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-5);
  margin-bottom: var(--wp-space-4);
  background: var(--wp-bg-2);
  /* Accent border rather than a filled panel: it should read as a note from
   * the author, not as a promotion. */
  border: 1px solid color-mix(in oklab, var(--wp-node) 45%, transparent);
  border-radius: var(--wp-radius-lg);
}
.wp-star__icon { color: var(--wp-node); font-size: 16px; margin-top: 2px; }
.wp-star__body { flex: 1 1 auto; min-width: 0; }
.wp-star__title { margin: 0 0 2px; font-size: var(--wp-text-sm); font-weight: 600; color: var(--wp-text); }
.wp-star__sub { margin: 0; font-size: var(--wp-text-xs); line-height: 1.55; color: var(--wp-text-muted); }
.wp-star__actions { display: flex; align-items: center; gap: var(--wp-space-2); flex-shrink: 0; }
.wp-star__go {
  font-size: var(--wp-text-xs);
  font-weight: 600;
  color: var(--wp-bg-1);
  background: var(--wp-node);
  border: 0;
  border-radius: var(--wp-radius);
  padding: 6px 13px;
  cursor: pointer;
}
.wp-star__go:hover { filter: brightness(1.08); }
.wp-star__quiet {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
  background: none;
  border: 0;
  padding: 6px 8px;
  cursor: pointer;
}
.wp-star__quiet:hover { color: var(--wp-text-muted); }
@media (max-width: 720px) {
  .wp-star { flex-wrap: wrap; }
  .wp-star__actions { width: 100%; justify-content: flex-end; }
}
</style>
