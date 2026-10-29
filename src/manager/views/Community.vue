<script setup lang="ts">
/**
 * Community — the Wildcard Pipeline Community embed, in a sandboxed iframe.
 *
 * The page (`${WPC_API_URL}/embed-frame.html`) runs on the community origin,
 * so nothing it loads executes in ComfyUI and its sign-in stays out of
 * ComfyUI's storage. It reaches this library only through the requests
 * `community/frameBridge.ts` serves (install a pack, link a published row).
 *
 * Navigation mirrors both ways: the frame's own clicks land in the router
 * (`/community/...`), and router changes go to the frame as `navigate`.
 * The publish payload single-row-publish puts in this page's hash is handed
 * to the frame and then stripped from the address bar.
 *
 * No `ready` from the frame within READY_TIMEOUT_MS → the offline card (host
 * down, offline, or a community server too old to serve the frame page).
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Card from "../components/ui/Card.vue";
import Icon from "../components/ui/Icon.vue";
import LoadingMark from "@/kit/LoadingMark.vue";
import { DISCORD_INVITE, WPC_API_URL, WPC_EMBED_FRAME_URL } from "../config/links";
import { connectFrame, type FrameBridge, type FrameTarget } from "../community/frameBridge";
import { readAppearance, watchAppearance } from "../community/appearance";
import { createHostRuntime } from "../community/hostRuntime";
import { readLegacyTokens, wipeLegacyTokens } from "../community/tokenStore";
import { useUiStore } from "../stores/uiStore";

const READY_TIMEOUT_MS = 10_000;

const route = useRoute();
const router = useRouter();
const ui = useUiStore();

const frameEl = ref<HTMLIFrameElement | null>(null);
const frameKey = ref(0);
const loadError = ref<string | null>(null);
const loading = ref(true);
let bridge: FrameBridge | null = null;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
let stopAppearance: (() => void) | null = null;

// Map the extension's `/community/...` URL to the embed's view shape.
// vue-router 4's `:rest(.*)*` matcher hands back an ARRAY of segments,
// not a joined string. Unknown paths fall through to browse.
function parseRoute(): FrameTarget {
  const raw = route.params.rest;
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  if (parts[0] === "p" && parts[1] && parts[2]) {
    return { view: "detail", slug: `${parts[1]}/${parts[2]}` };
  }
  if (parts[0] === "u" && parts[1]) {
    return { view: "profile", username: parts[1] };
  }
  // /community/publish — per-row Upload buttons land here with the payload
  // in the hash (single-row-publish.ts); see forwardPublishHash.
  if (parts[0] === "publish") return { view: "publish" };
  if (parts[0] === "bundles") return { view: "bundles" };
  if (parts[0] === "library") return { view: "library" };
  if (parts[0] === "deleted") return { view: "deleted" };
  return { view: "browse" };
}

// The frame's address is set when it is created; later moves go over the
// bridge, so a route change doesn't reload it.
function buildSrc(): string {
  const target = parseRoute();
  const q = new URLSearchParams({ view: target.view, theme: ui.themeMode });
  if (target.slug) q.set("slug", target.slug);
  if (target.username) q.set("username", target.username);
  return `${WPC_EMBED_FRAME_URL}?${q.toString()}`;
}
const frameSrc = ref(buildSrc());

function onFrameNavigate(next: FrameTarget) {
  // Each view needs its own URL segment so the parseRoute round-trip keeps
  // it. `publish` is host-initiated (it carries a payload), never mirrored.
  if (next.view === "detail" && next.slug) {
    const [owner, name] = next.slug.split("/");
    router.replace(`/community/p/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}`);
  } else if (next.view === "profile" && next.username) {
    router.replace(`/community/u/${encodeURIComponent(next.username)}`);
  } else if (next.view === "bundles" || next.view === "library" || next.view === "deleted") {
    router.replace(`/community/${next.view}`);
  } else if (next.view !== "publish") {
    router.replace("/community");
  }
}

/** Hand the publish payload in this page's hash to the frame, then strip it
 *  (it is a whole module payload; the frame keeps its own copy). */
function forwardPublishHash() {
  if (!bridge || parseRoute().view !== "publish") return;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return;
  bridge.publish(hash);
  history.replaceState(history.state, "", window.location.pathname + window.location.search);
}

function stopTimer() {
  if (readyTimer !== null) clearTimeout(readyTimer);
  readyTimer = null;
}

function connect() {
  bridge?.dispose();
  stopTimer();
  if (!frameEl.value) return;
  bridge = connectFrame({
    iframe: frameEl.value,
    origin: new URL(WPC_EMBED_FRAME_URL).origin,
    runtime: createHostRuntime(),
    // Raw mode, not the resolved colour: the embed resolves "auto" itself.
    theme: () => ui.themeMode,
    // Palette, look and resolved light/dark, so the page wears this theme.
    appearance: () => readAppearance(),
    // Settings → General → "Share anonymous usage stats".
    analytics: () => ui.usageStats,
    legacyTokens: readLegacyTokens,
    onTokensAdopted: wipeLegacyTokens,
    onReady: () => {
      stopTimer();
      loading.value = false;
      loadError.value = null;
    },
    onNavigate: onFrameNavigate,
    onClose: () => router.replace("/dashboard"),
  });
  readyTimer = setTimeout(() => {
    readyTimer = null;
    if (!loading.value) return;
    loading.value = false;
    loadError.value = `No answer from ${WPC_API_URL} within ${READY_TIMEOUT_MS / 1000} s.`;
  }, READY_TIMEOUT_MS);
  forwardPublishHash();
}

async function retry() {
  loadError.value = null;
  loading.value = true;
  frameKey.value += 1;
  frameSrc.value = buildSrc();
  await nextTick();
  connect();
}

// Route changes inside /community/... move the frame instead of reloading it,
// so it keeps its scroll position and fetched lists.
watch(
  () => route.fullPath,
  () => {
    bridge?.navigate(parseRoute());
    forwardPublishHash();
  },
);

watch(
  () => ui.themeMode,
  (mode) => bridge?.setTheme(mode),
);

function onHashChange() {
  forwardPublishHash();
}

onMounted(() => {
  window.addEventListener("hashchange", onHashChange);
  // Theme, palette, look and accent all land on <html>; one observer
  // forwards every change.
  stopAppearance = watchAppearance((a) => bridge?.setAppearance(a));
  connect();
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", onHashChange);
  stopAppearance?.();
  stopAppearance = null;
  stopTimer();
  bridge?.dispose();
  bridge = null;
});
</script>

<template>
  <div class="wp-community-root">
    <LoadingMark v-if="loading" :size="48" block>Opening Community…</LoadingMark>
    <iframe
      v-if="!loadError"
      :key="frameKey"
      ref="frameEl"
      class="wp-community-frame"
      :class="{ 'wp-community-frame--loading': loading }"
      :src="frameSrc"
      title="Wildcard Pipeline Community"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
      referrerpolicy="strict-origin"
    />

    <Card v-if="loadError" title="Community is offline" class="wp-community-offline">
      <p class="wp-community-offline__lead">
        We couldn't load the community right now. The host may be down,
        your network may be offline, or the community server may need an
        update for this version of the extension.
      </p>
      <pre class="wp-community-offline__detail">{{ loadError }}</pre>
      <div class="wp-community-offline__actions">
        <button class="wp-btn wp-btn--primary" @click="retry">
          <Icon name="pi-refresh" />Retry
        </button>
        <a
          class="wp-btn wp-btn--ghost"
          :href="DISCORD_INVITE"
          target="_blank"
          rel="noopener"
        >
          <Icon name="pi-discord" />Open Discord invite
        </a>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.wp-community-root {
  position: relative;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.wp-community-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  /* The page draws square edges; the tab rounds them by the look, and the
     page's own colour fills the frame from the first paint. */
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg);
  color-scheme: dark;
}
:global(html.wp-theme-light) .wp-community-frame { color-scheme: light; }
.wp-community-frame--loading {
  /* Loads behind the spinner; position: absolute keeps it out of the flow. */
  position: absolute;
  visibility: hidden;
}
.wp-community-offline {
  margin: var(--wp-space-6);
  max-width: 640px;
}
.wp-community-offline__lead {
  margin: 0 0 var(--wp-space-3);
  color: var(--wp-text);
  font-size: var(--wp-text-base);
}
.wp-community-offline__detail {
  margin: 0 0 var(--wp-space-4);
  padding: var(--wp-space-3);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
  background: var(--wp-bg-elevated);
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  white-space: pre-wrap;
  word-break: break-word;
}
.wp-community-offline__actions {
  display: flex;
  gap: var(--wp-space-2);
  flex-wrap: wrap;
}
.wp-community-offline__actions .wp-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  text-decoration: none;
}
</style>
