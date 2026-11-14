<script setup lang="ts">
/**
 * The page's tutorial videos under its title: one link per video (it opens on
 * YouTube in a new tab) and one to the whole section's playlist. Docs.vue
 * names the open page; a page with no videos shows nothing.
 */
import { computed, inject } from "vue";
import Button from "@/kit/Button.vue";
import { DOC_PAGE_ID, findSection, pageVideos, playlistUrl, videoUrl } from "../../docs/videos";

const pageId = inject(DOC_PAGE_ID, null);
const videos = computed(() => pageVideos(pageId?.value));
/** The playlist of the page's first video, so a node page offers every node video. */
const section = computed(() => {
  const first = videos.value[0];
  return first ? findSection(first.section) : undefined;
});
</script>

<template>
  <div v-if="videos.length" class="wp-doc-videos" data-test="doc-videos">
    <span class="wp-doc-videos__label"><i class="pi pi-youtube" aria-hidden="true" /> Watch</span>
    <Button
      v-for="v in videos"
      :key="v.code"
      as="a"
      :href="videoUrl(v)"
      target="_blank"
      rel="noopener noreferrer"
      size="sm"
      variant="outline"
      icon="pi-play"
      :hint="`Opens the video on YouTube (${v.code})`"
      data-test="doc-video"
    >{{ v.title }}</Button>
    <Button
      v-if="section"
      as="a"
      :href="playlistUrl(section)"
      target="_blank"
      rel="noopener noreferrer"
      size="sm"
      variant="link"
      icon-right="pi-external-link"
      data-test="doc-video-playlist"
    >All {{ section.title }} videos</Button>
  </div>
</template>

<style scoped>
.wp-doc-videos { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: calc(-1 * var(--wp-space-3, 10px)); }
.wp-doc-videos__label {
  display: inline-flex; align-items: center; gap: 6px; margin-right: 2px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--wp-text-muted);
}
.wp-doc-videos__label .pi { font-size: 13px; color: var(--doc-tone); }
</style>
