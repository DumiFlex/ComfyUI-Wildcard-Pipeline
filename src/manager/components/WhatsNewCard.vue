<script setup lang="ts">
/**
 * What changed since the last time this person looked.
 *
 * Reuses the release body the update check already fetches, cut at the
 * `<!-- /modal -->` marker — the same highlights-only slice the update dialog
 * shows, for the same reason: this is a "here is what you got" note, not the
 * release page.
 *
 * Inline rather than a modal, and dismissible. The extension already raises an
 * update dialog; a second modal on the next SPA open would be the same news
 * twice, which is how a useful note turns into a nag.
 *
 * Silent on a fresh install: someone who has never recorded a version has no
 * "new" to be told about, only a product they have not seen yet.
 */
import { computed } from "vue";
import { renderReleaseNotes } from "../utils/releaseNotes";
import { useEngagementStore } from "../stores/engagementStore";

const props = defineProps<{
  /** Installed version, as reported by the release check. */
  version: string | null;
  /** Raw markdown release body for `version`, when it has been fetched. */
  body: string | null;
  /** Link to the full notes for this release. */
  url?: string | null;
}>();

const engagement = useEngagementStore();

const visible = computed(
  () => engagement.hasUnseenRelease(props.version) && !!(props.body || "").trim(),
);
const notesHtml = computed(() => renderReleaseNotes(props.body ?? ""));
</script>

<template>
  <section v-if="visible" class="wp-whatsnew" data-test="whats-new">
    <header class="wp-whatsnew__head">
      <span class="wp-whatsnew__title">
        <i class="pi pi-sparkles wp-whatsnew__icon" aria-hidden="true" />
        What's new in {{ version }}
      </span>
      <button
        type="button"
        class="wp-whatsnew__close"
        aria-label="Dismiss what's new"
        data-test="whats-new-dismiss"
        @click="engagement.markReleaseSeen(props.version)"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <!-- Produced by renderReleaseNotes, which escapes before transforming —
         the same sanctioned v-html the update dialog uses. -->
    <div class="wp-whatsnew__body" v-html="notesHtml" />

    <a
      v-if="url"
      class="wp-whatsnew__more"
      :href="url"
      target="_blank"
      rel="noopener"
      data-test="whats-new-full"
    >Full release notes →</a>
  </section>
</template>

<style scoped>
.wp-whatsnew {
  padding: var(--wp-space-4) var(--wp-space-5);
  margin-bottom: var(--wp-space-4);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
}
.wp-whatsnew__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--wp-space-2); }
.wp-whatsnew__title { display: inline-flex; align-items: center; gap: var(--wp-space-2); font-size: var(--wp-text-sm); font-weight: 600; color: var(--wp-text); }
.wp-whatsnew__icon { color: var(--wp-node); font-size: 14px; }
.wp-whatsnew__close { background: none; border: 0; color: var(--wp-text-dim); cursor: pointer; padding: 2px 4px; font-size: 12px; }
.wp-whatsnew__close:hover { color: var(--wp-text); }
.wp-whatsnew__body { font-size: var(--wp-text-xs); line-height: 1.6; color: var(--wp-text-muted); }
.wp-whatsnew__body :deep(h2),
.wp-whatsnew__body :deep(h3) { font-size: var(--wp-text-xs); font-weight: 600; color: var(--wp-text); margin: var(--wp-space-3) 0 var(--wp-space-2); }
.wp-whatsnew__body :deep(ul) { margin: var(--wp-space-2) 0; padding-left: var(--wp-space-5); }
.wp-whatsnew__body :deep(li) { margin: 3px 0; }
.wp-whatsnew__body :deep(strong) { color: var(--wp-text); }
.wp-whatsnew__body :deep(code) { font-family: var(--wp-font-mono); background: var(--wp-bg-1); padding: 1px 4px; border-radius: 3px; }
.wp-whatsnew__more { display: inline-block; margin-top: var(--wp-space-2); font-size: var(--wp-text-xs); color: var(--wp-accent-text); }
</style>
