<script setup lang="ts">
/**
 * Community — placeholder landing while the full discover / upload /
 * profile flow bakes.
 *
 * Primary CTA: Discord invite. The discover/upload UI ships when
 * `feat/community-tab` lands; until then, in-flight design feedback +
 * Q&A happens on Discord.
 *
 * Both URLs live in `manager/config/links.ts` — the Discord invite
 * rotates if the server resets invite settings, and the repo slug
 * may change when we rename the public repo. Centralized so a swap
 * is a one-line change.
 */
import Card from "../components/ui/Card.vue";
import Icon from "../components/ui/Icon.vue";
import { DISCORD_INVITE } from "../config/links";
</script>

<template>
  <div class="wp-page wp-community-wip">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Community</h1>
        <p class="wp-page__subtitle">Share + discover wildcard packs.</p>
      </div>
    </div>

    <Card title="Join the conversation">
      <div class="wp-community-wip__body">
        <div class="wp-community-wip__brand" aria-hidden="true">
          <Icon name="pi-discord" :size="32" />
        </div>
        <div class="wp-community-wip__copy">
          <p class="wp-community-wip__lead">
            The full Community hub is being designed. While it's in flight,
            jump on Discord for help, feedback, and the work-in-progress feed.
          </p>
          <div class="wp-community-wip__actions">
            <a
              class="wp-btn wp-btn--primary wp-btn--md"
              :href="DISCORD_INVITE"
              target="_blank"
              rel="noopener"
            >
              <Icon name="pi-discord" />
              <span>Open Discord invite</span>
              <Icon name="pi-external-link" />
            </a>
            <a
              class="wp-community-wip__alt"
              :href="DISCORD_INVITE"
              target="_blank"
              rel="noopener"
            >{{ DISCORD_INVITE }}</a>
          </div>
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
.wp-community-wip__brand {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklab, var(--wp-accent) 16%, transparent);
  color: var(--wp-accent);
}
.wp-community-wip__copy {
  flex: 1;
  min-width: 0;
}
.wp-community-wip__lead {
  margin: 0 0 var(--wp-space-4);
  font-size: var(--wp-text-base);
  color: var(--wp-text);
}
.wp-community-wip__actions {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  align-items: flex-start;
}
/* Anchor styled as primary button — reuses the same .wp-btn family
 * styles applied by Button.vue. text-decoration:none kills the
 * default anchor underline; everything else inherits from .wp-btn. */
.wp-community-wip__actions .wp-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
}
.wp-community-wip__alt {
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
  text-decoration: none;
}
.wp-community-wip__alt:hover {
  color: var(--wp-text);
  text-decoration: underline;
}
</style>
