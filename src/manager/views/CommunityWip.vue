<script setup lang="ts">
/**
 * Community — work-in-progress placeholder.
 *
 * The full discover / detail / upload / profile flow lives on the
 * `feat/community-tab` branch. Main ships only this stub so the
 * sidebar entry has somewhere to land while the feature bakes.
 */
import Card from "../components/ui/Card.vue";
import Icon from "../components/ui/Icon.vue";

const branchUrl =
  "https://github.com/DumiFlex/ComfyUI-WildcardPipeline/tree/feat/community-tab";
</script>

<template>
  <div class="wp-page wp-community-wip">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Community</h1>
        <p class="wp-page__subtitle">Share + discover wildcard packs.</p>
      </div>
    </div>

    <Card title="Work in progress">
      <div class="wp-community-wip__body">
        <Icon name="pi-clock" :size="22" />
        <div>
          <p class="wp-community-wip__lead">
            Community hub is being designed. Not shipped on main yet.
          </p>
          <p class="wp-dim wp-community-wip__hint">
            Track the work-in-progress UI on the
            <a
              class="wp-community-wip__link wp-mono"
              :href="branchUrl"
              target="_blank"
              rel="noopener"
            ><Icon name="pi-github" /> feat/community-tab</a>
            branch.
          </p>
        </div>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.wp-community-wip { max-width: 720px; }

.wp-community-wip__body {
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-6);
  padding: var(--wp-space-2) 0;
}
.wp-community-wip__lead {
  margin: 0 0 var(--wp-space-3);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--wp-text);
}
.wp-community-wip__hint {
  margin: 0;
  font-size: 12.5px;
}
.wp-community-wip__link {
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
}
.wp-community-wip__link:hover { color: var(--wp-text); }
</style>
