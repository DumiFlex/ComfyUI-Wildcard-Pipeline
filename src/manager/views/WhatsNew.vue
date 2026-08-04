<script setup lang="ts">
/**
 * What's new — release notes for the build actually installed.
 *
 * A PAGE rather than a dashboard card. As a card it occupied the top of the
 * home view permanently to deliver something read once, and it competed with
 * the hero for the first thing a returning user sees. A topbar button with an
 * unread dot costs a few pixels, says "there is something here" just as
 * clearly, and — unlike a dismissible card — is still there next week when
 * someone wants to check what changed.
 *
 * This is also the only place in the app that shows notes for the version you
 * are RUNNING. The topbar update pill renders solely when a newer release
 * exists, so once you are current there was previously no way back to them.
 *
 * Visiting counts as reading: the unread dot clears on mount. There is no
 * dismiss button, because leaving is the dismissal.
 */
import { computed, onMounted } from "vue";

import Card from "../components/ui/Card.vue";
import Icon from "../components/ui/Icon.vue";
import Button from "../components/ui/Button.vue";
import { useReleaseCheck } from "../composables/useReleaseCheck";
import { useEngagementStore } from "../stores/engagementStore";
import { renderReleaseNotes } from "../utils/releaseNotes";
import { GITHUB_REPO } from "../config/links";

const release = useReleaseCheck();
const engagement = useEngagementStore();

/**
 * Whether the fetched notes describe the installed build.
 *
 * While an update is pending they describe the NEWER release — changes the
 * reader does not have yet. Rather than hide the page (its whole purpose is
 * being reachable), it says so plainly and labels the notes with the version
 * they belong to. Claiming them as "your version" would be a lie, and hiding
 * them would be unhelpful.
 */
const isInstalled = computed(() => release.latestVersion.value === release.current);
const notesVersion = computed(() => release.latestVersion.value ?? release.current);
const body = computed(() => release.releaseBody.value ?? "");
const notesHtml = computed(() => renderReleaseNotes(body.value, { full: true }));
const hasNotes = computed(() => body.value.trim().length > 0);
const fullUrl = computed(() => release.releaseUrl.value ?? `${GITHUB_REPO}/releases`);

onMounted(() => {
  // Reaching the page IS reading it, whether or not the notes had loaded —
  // otherwise a slow network leaves the dot lit after a deliberate visit.
  engagement.markReleaseSeen(release.current);
});
</script>

<template>
  <div class="wp-page" data-test="whats-new-page">
    <div class="wp-hero wp-whatsnew-hero">
      <!-- Same glyph as the topbar button that leads here, so the destination
           confirms the control the reader just clicked. -->
      <div class="wp-hero__icon"><Icon name="pi-megaphone" /></div>
      <div class="wp-whatsnew-hero__text">
        <h2 class="wp-hero__title">What's new</h2>
        <p class="wp-hero__sub">
          Release notes for
          <strong>v{{ notesVersion }}</strong>
          <template v-if="!isInstalled"> — you are running v{{ release.current }}</template>.
        </p>
      </div>
      <a
        class="wp-btn wp-btn--outline wp-btn--sm wp-whatsnew-hero__link"
        :href="fullUrl"
        target="_blank"
        rel="noopener"
        data-test="whats-new-github"
      >
        <Icon name="pi-github" /> All releases
      </a>
    </div>

    <Card>
      <div v-if="hasNotes" class="wp-relnotes" data-test="whats-new-body" v-html="notesHtml" />
      <div v-else class="wp-relnotes__none" data-test="whats-new-empty">
        <Icon name="pi-inbox" />
        <p>
          No release notes loaded yet. They are fetched from GitHub — if you are
          offline, or the hourly API allowance is spent, try again later.
        </p>
        <Button variant="outline" size="sm" icon="pi-refresh" :loading="release.checking.value" @click="release.checkNow()">
          Check again
        </Button>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.wp-whatsnew-hero__text { flex: 1; min-width: 0; }
.wp-whatsnew-hero__link { flex: none; text-decoration: none; }

/* Long-form variant of the dialog's note styling: this surface has a full
 * page of width, so headings and spacing can breathe instead of being
 * compressed into a modal. */
.wp-relnotes { font-size: var(--wp-text-sm); line-height: 1.65; color: var(--wp-text-muted); }
.wp-relnotes :deep(h2) { font-size: var(--wp-text-lg); }
.wp-relnotes :deep(h3) { font-size: var(--wp-text-base); }
.wp-relnotes :deep(h2),
.wp-relnotes :deep(h3) {
  font-weight: 600;
  color: var(--wp-text);
  margin: var(--wp-space-6) 0 var(--wp-space-3);
}
.wp-relnotes :deep(h2:first-child),
.wp-relnotes :deep(h3:first-child) { margin-top: 0; }
.wp-relnotes :deep(p) { margin: var(--wp-space-3) 0; }
/* `list-style` is explicit because the app reset clears it globally. */
.wp-relnotes :deep(ul) {
  margin: var(--wp-space-3) 0;
  padding-left: var(--wp-space-6);
  list-style: disc outside;
}
.wp-relnotes :deep(li) { margin: var(--wp-space-2) 0; }
.wp-relnotes :deep(li)::marker { color: var(--wp-accent-text); }
.wp-relnotes :deep(strong) { color: var(--wp-text); font-weight: 600; }
.wp-relnotes :deep(code) {
  font-family: var(--wp-font-mono);
  font-size: 0.92em;
  background: var(--wp-bg-3);
  padding: 1px 5px;
  border-radius: var(--wp-radius-sm);
}
.wp-relnotes :deep(a) { color: var(--wp-accent-text); }
.wp-relnotes :deep(hr) { border: 0; border-top: 1px solid var(--wp-border); margin: var(--wp-space-6) 0; }

.wp-relnotes__none {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-7) var(--wp-space-5);
  text-align: center;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}
.wp-relnotes__none .pi { font-size: 26px; color: var(--wp-text-dim); }
.wp-relnotes__none p { margin: 0; max-width: 46ch; }
</style>
