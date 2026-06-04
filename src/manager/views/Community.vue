<script setup lang="ts">
/**
 * Community — mounts the Wildcard Pipeline Community embed bundle.
 *
 * The bundle ships from the community web host (`WPC_API_URL`) and
 * re-bundles Vue internally (separate module scope from this
 * extension's Vue). We dynamic-import it on first visit, mount it
 * into a slot div, drive navigation through the handle, and tear it
 * down on `onBeforeUnmount`.
 *
 * Auth: a localStorage-backed TokenStore. Until the device-flow
 * runner lands inside the extension shell the store reports null,
 * so the embed renders anonymously (public posts only) — perfect
 * fallback for v1.
 *
 * Offline / unreachable host: the loader throws `EmbedLoadError`;
 * we surface a retry + the Discord invite so users can still get
 * unblocked.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Card from "../components/ui/Card.vue";
import Icon from "../components/ui/Icon.vue";
import { DISCORD_INVITE, WPC_API_URL } from "../config/links";
import {
  EmbedLoadError,
  loadEmbed,
  type EmbedHandle,
  type EmbedNavigateTarget,
} from "../community/embedLoader";
import { createWpcTokenStore } from "../community/tokenStore";

const route = useRoute();
const router = useRouter();

const containerEl = ref<HTMLDivElement | null>(null);
const handle = ref<EmbedHandle | null>(null);
const loadError = ref<string | null>(null);
const loading = ref(true);

// Map the extension's `/community/...` URL to the embed's view shape.
// `/community` → browse, `/community/p/owner/name` → detail,
// `/community/u/username` → profile. Everything else falls through
// to browse so the embed doesn't 404 on a stale deep-link.
//
// vue-router 4's `:rest(.*)*` matcher hands back an ARRAY of segments
// (one per `/` between the catch-all and the end of the URL) — NOT a
// pre-joined string. `String(arr)` then comma-joins, which made
// parseRoute always return browse and triggered an immediate
// router.replace back to `/community` after every detail navigation
// (URL flickered, first click visibly bounced).
function parseRoute(): EmbedNavigateTarget {
  const raw = route.params.rest;
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  if (parts[0] === "p" && parts[1] && parts[2]) {
    return { view: "detail", slug: `${parts[1]}/${parts[2]}` };
  }
  if (parts[0] === "u" && parts[1]) {
    return { view: "profile", username: parts[1] };
  }
  return { view: "browse" };
}

async function tryMount() {
  loading.value = true;
  loadError.value = null;
  // On retry, the host div is v-if'd out while loadError is set —
  // wait one tick so Vue mounts it back before we read the ref.
  await nextTick();
  if (!containerEl.value) return;
  try {
    const mod = await loadEmbed();
    const target = parseRoute();
    handle.value = mod.mount({
      containerEl: containerEl.value,
      view: target.view,
      ...(target.slug ? { initialSlug: target.slug } : {}),
      ...(target.username ? { initialUsername: target.username } : {}),
      apiBaseUrl: WPC_API_URL,
      tokenStore: createWpcTokenStore(WPC_API_URL),
      theme: "auto",
      onNavigate: (next) => {
        // Mirror the embed's internal nav into the extension router
        // so the URL bar reflects state + the back button works.
        if (next.view === "detail" && next.slug) {
          router.replace(`/community/p/${next.slug}`);
        } else if (next.view === "profile" && next.username) {
          router.replace(`/community/u/${next.username}`);
        } else {
          router.replace("/community");
        }
      },
      onClose: () => router.replace("/dashboard"),
      onUnauthenticated: () => {
        // Device flow comes in a follow-up. For now the embed handles
        // the anonymous fallback itself; if a once-authenticated user
        // hits 401, we clear local tokens so the next render is
        // anonymous rather than looping.
        createWpcTokenStore(WPC_API_URL).clear();
      },
    });
  } catch (err) {
    if (err instanceof EmbedLoadError) {
      loadError.value = `Couldn't reach ${WPC_API_URL}. ${err.message}`;
    } else {
      loadError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    loading.value = false;
  }
}

// Route changes inside /community/... drive the embed via its handle
// rather than remounting — the embed keeps its scroll position, its
// fetched list state, etc.
watch(
  () => route.fullPath,
  () => {
    if (handle.value) {
      handle.value.navigate(parseRoute());
    }
  },
);

onMounted(tryMount);

onBeforeUnmount(() => {
  handle.value?.unmount();
  handle.value = null;
});
</script>

<template>
  <div class="wp-community-root">
    <div
      v-if="loading || !loadError"
      ref="containerEl"
      class="wp-community-host"
    />

    <Card v-if="loadError" title="Community is offline" class="wp-community-offline">
      <p class="wp-community-offline__lead">
        We couldn't load the community right now. The host may be down
        or your network is offline.
      </p>
      <pre class="wp-community-offline__detail">{{ loadError }}</pre>
      <div class="wp-community-offline__actions">
        <button class="wp-btn wp-btn--primary" @click="tryMount">
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
  min-height: 100%;
  display: flex;
  flex-direction: column;
}
.wp-community-host {
  flex: 1;
  min-height: 0;
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
  border-radius: 8px;
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
