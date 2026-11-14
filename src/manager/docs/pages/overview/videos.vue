<script setup lang="ts">
import { RouterLink } from "vue-router";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import Button from "@/kit/Button.vue";
import Chip from "@/kit/Chip.vue";
import Banner from "@/kit/Banner.vue";
import { PAGE_VIDEOS, VIDEO_SECTIONS, playlistUrl, videoUrl, videosIn } from "../../videos";
import { findPage } from "../../registry";
import { TUTORIAL_LIBRARY } from "../../../config/links";

/** The docs page a video is about (one that lists it first, else any that
 *  lists it), so each row can open its page too. */
function docFor(code: string): { id: string; title: string } | undefined {
  const pages = Object.keys(PAGE_VIDEOS);
  const id = pages.find((p) => PAGE_VIDEOS[p]?.[0] === code) ?? pages.find((p) => PAGE_VIDEOS[p]?.includes(code));
  const meta = id ? findPage(id) : undefined;
  return meta ? { id: meta.id, title: meta.title } : undefined;
}
</script>

<template>
  <DocPage
    group="Overview"
    title="Video tutorials"
    icon="pi pi-youtube"
    tone="neutral"
    blurb="Every feature shown on the real canvas and manager, with narration and captions, in six playlists."
  >
    <DocSection title="How to watch">
      <p>
        The videos are on YouTube, one playlist per section. <b>Get started</b> goes from a first look to
        bundles in about half an hour; the other sections go deeper, one feature or node per video. Each
        video opens in a new tab, with chapters and English captions.
      </p>
      <p>
        Most docs pages show their own videos under the title, after <b>Watch</b>. Every video starts
        from the same small library: <b>Before you start</b> shows how to import it into an empty
        library, and each video's description links it.
      </p>
      <Button
        as="a"
        :href="TUTORIAL_LIBRARY"
        target="_blank"
        rel="noopener noreferrer"
        size="sm"
        variant="outline"
        icon="pi-download"
        icon-right="pi-external-link"
        class="wp-doc-vids__lib"
        data-test="doc-tutorial-library"
      >The tutorial library on GitHub</Button>
      <Banner tone="info" note>
        The videos were recorded on version 2.22. A screen may look a little different on a later version.
      </Banner>
    </DocSection>

    <DocSection v-for="s in VIDEO_SECTIONS" :key="s.id" :title="s.title">
      <div class="wp-doc-vids__head">
        <p class="wp-doc-vids__blurb">{{ s.blurb }}</p>
        <Button
          as="a"
          :href="playlistUrl(s)"
          target="_blank"
          rel="noopener noreferrer"
          size="sm"
          variant="outline"
          icon="pi-youtube"
          icon-right="pi-external-link"
          :data-test="`doc-playlist-${s.id}`"
        >Play all {{ videosIn(s.id).length }}</Button>
      </div>
      <ol class="wp-doc-vids__list">
        <li v-for="v in videosIn(s.id)" :key="v.code" class="wp-doc-vids__row">
          <Chip size="xs" class="wp-doc-vids__code">{{ v.code }}</Chip>
          <Button
            as="a"
            :href="videoUrl(v)"
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            variant="link"
            icon="pi-play"
            class="wp-doc-vids__title"
            data-test="doc-video-row"
          >{{ v.title }}</Button>
          <RouterLink v-if="docFor(v.code)" :to="`/docs/${docFor(v.code)?.id}`" class="wp-doc-vids__doc">
            <i class="pi pi-book" aria-hidden="true" /> {{ docFor(v.code)?.title }}
          </RouterLink>
        </li>
      </ol>
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-vids__lib { align-self: flex-start; }
.wp-doc-vids__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.wp-doc-vids__blurb { margin: 0; color: var(--wp-text-muted); font-size: 13px; flex: 1 1 320px; }
.wp-doc-section__body .wp-doc-vids__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--wp-border); border-radius: min(10px, var(--wp-radius-cap, 999px)); overflow: hidden; }
.wp-doc-section__body .wp-doc-vids__row { margin: 0; line-height: 1.4; display: flex; align-items: center; gap: 10px; padding: 4px 12px; min-height: 36px; background: var(--wp-bg-2); }
.wp-doc-vids__row + .wp-doc-vids__row { border-top: 1px solid var(--wp-border); }
.wp-doc-vids__row:hover { background: var(--wp-bg-3); }
.wp-doc-vids__code { flex: 0 0 auto; min-width: 42px; justify-content: center; font-family: var(--wp-font-mono); }
.wp-doc-vids__title { min-width: 0; }
.wp-doc-vids__doc { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--wp-text-muted); text-decoration: none; white-space: nowrap; }
.wp-doc-vids__doc:hover { color: var(--wp-text); text-decoration: underline; }
.wp-doc-vids__doc .pi { font-size: 11px; }
</style>
