<script setup lang="ts">
/**
 * Community → Module / Bundle detail screen.
 *
 * Hero, install + star + report buttons, stats strip, and four tabs:
 * README, Preview (kind-aware), Versions changelog, Reviews.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "../../components/ui/Button.vue";
import { useToast } from "../../composables/useToast";
import { useCommunityStore } from "../../stores/communityStore";
import { engineSatisfies } from "../../community/mockApi";
import { renderMarkdown } from "../../community/markdown";
import { KIND_ICON, KIND_LABEL, fmtNumber, relativeTime } from "../../community/format";
import type { CommunityAtom, CommunityVersion } from "../../community/types";

const props = defineProps<{ id: string }>();

const router = useRouter();
const store = useCommunityStore();
const toast = useToast();

const atom = ref<CommunityAtom | null>(null);
const loading = ref(true);
const error = ref<"offline" | "404" | null>(null);
const tab = ref<"readme" | "preview" | "versions" | "reviews">("readme");
const selectedVersion = ref<string | null>(null);
const installing = ref(false);

const installed = computed(() => atom.value && store.installed.has(atom.value.id));
const starred = computed(() => atom.value && store.starred.has(atom.value.id));
const compatible = computed(() => {
  if (!atom.value) return true;
  return engineSatisfies(store.engineVersion, atom.value.engine_min_version || "0");
});

const renderedReadme = computed(() => atom.value ? renderMarkdown(atom.value.readme) : "");

const previewKind = computed(() => {
  if (!atom.value) return "wildcard";
  return atom.value.type === "bundle" ? "bundle" : atom.value.type;
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const result = await store.getModule(props.id);
    atom.value = result;
    selectedVersion.value = result.versions[0]?.version ?? null;
  } catch (e) {
    const code = (e as Error & { code?: number }).code;
    if (code === 404) {
      error.value = "404";
      router.replace({ name: "community-404" });
    } else {
      error.value = "offline";
      router.replace({ name: "community-offline" });
    }
  } finally {
    loading.value = false;
  }
}

async function onInstall() {
  if (!atom.value) return;
  installing.value = true;
  try {
    await store.install(atom.value.id);
    toast.push({ severity: "success", summary: "Installed", detail: atom.value.name, life: 2500 });
  } catch {
    toast.push({ severity: "error", summary: "Install failed", detail: "Registry unreachable.", life: 3000 });
  } finally {
    installing.value = false;
  }
}

async function onUninstall() {
  if (!atom.value) return;
  try {
    await store.uninstall(atom.value.id);
    toast.push({ severity: "info", summary: "Removed", detail: atom.value.name, life: 2500 });
  } catch {
    toast.push({ severity: "error", summary: "Could not remove", life: 3000 });
  }
}

async function onStar() {
  if (!atom.value) return;
  if (!store.currentUser) {
    toast.push({ severity: "info", summary: "Sign in to star modules.", life: 2500 });
    return;
  }
  await store.toggleStar(atom.value.id);
}

function onBack() {
  router.push({ name: "community-discover" });
}

const tabs: { key: "readme" | "preview" | "versions" | "reviews"; label: string }[] = [
  { key: "readme",   label: "README" },
  { key: "preview",  label: "Preview" },
  { key: "versions", label: "Versions" },
  { key: "reviews",  label: "Reviews" },
];

function previewOptions(): { value: string; weight: number }[] {
  if (!atom.value || atom.value.type === "bundle") return [];
  return atom.value.preview_options ?? [];
}

function bundleSamples(): string[] {
  if (!atom.value || atom.value.type !== "bundle") return [];
  return atom.value.preview_samples ?? [];
}

function bundleSubKinds(): string[] {
  if (!atom.value || atom.value.type !== "bundle") return [];
  return atom.value.sub_kinds;
}

function changelog(): CommunityVersion[] {
  return atom.value?.versions ?? [];
}

const previewTotal = computed(() => {
  const opts = previewOptions();
  return opts.reduce((sum, o) => sum + (o.weight || 0), 0) || 1;
});

watch(() => props.id, () => { load(); });
onMounted(() => load());
</script>

<template>
  <div class="wp-comm-page">
    <Button
      variant="ghost"
      icon="arrow-left"
      class="self-start"
      @click="onBack"
    >Back to Community</Button>

    <div v-if="loading" class="wp-comm-empty">Loading...</div>

    <template v-else-if="atom">
      <!-- Hero -->
      <section class="wp-comm-detail-hero" :style="{ background: atom.hero }">
        <div class="wp-comm-detail-hero__inner">
          <div class="grow">
            <span class="wp-comm-card__kind">
              <i :class="['pi', KIND_ICON[atom.type === 'bundle' ? 'bundle' : atom.type]]" aria-hidden="true" />
              {{ KIND_LABEL[atom.type === "bundle" ? "bundle" : atom.type] }}
            </span>
            <span v-if="atom.nsfw" class="wp-comm-card__nsfw" style="position: static; margin-left: 8px;">18+</span>
            <h1 class="wp-comm-detail-hero__title">{{ atom.name }}</h1>
            <p class="wp-comm-detail-hero__tagline">{{ atom.tagline }}</p>
            <div class="wp-comm-detail-hero__meta">
              <span class="wp-comm-detail-hero__author">
                <span
                  class="wp-comm-card__avatar"
                  :style="{ backgroundImage: `url(${atom.author.avatar_url})` }"
                  aria-hidden="true"
                />
                <span>@{{ atom.author.login }}</span>
                <i v-if="atom.author.verified" class="pi pi-verified" aria-hidden="true" />
              </span>
              <span>·</span>
              <span><i class="pi pi-clock" aria-hidden="true" /> updated {{ relativeTime(atom.updated_at) }}</span>
              <span>·</span>
              <span><i class="pi pi-bookmark" aria-hidden="true" /> {{ atom.license }}</span>
              <span>·</span>
              <span><i class="pi pi-cog" aria-hidden="true" /> engine ≥ {{ atom.engine_min_version }}</span>
            </div>
          </div>
          <div class="wp-comm-detail-hero__actions">
            <Button
              v-if="installed"
              variant="secondary"
              icon="check"
              @click="onUninstall"
            >Installed — Remove</Button>
            <Button
              v-else
              variant="primary"
              icon="download"
              :disabled="!compatible || installing"
              @click="onInstall"
            >{{ atom.type === 'bundle' ? 'Install pack' : 'Install module' }}</Button>
            <Button
              variant="secondary"
              :icon="starred ? 'star-fill' : 'star'"
              @click="onStar"
            >{{ starred ? 'Starred' : 'Star' }}</Button>
            <Button
              variant="ghost"
              icon="flag"
              aria-label="Report module"
            />
          </div>
        </div>
      </section>

      <!-- Stats strip -->
      <div class="wp-comm-detail-stats">
        <div><span>Downloads</span><strong>{{ fmtNumber(atom.downloads) }}</strong></div>
        <div><span>Stars</span><strong>{{ fmtNumber(atom.stars + (starred ? 1 : 0)) }}</strong></div>
        <div><span>Rating</span><strong>{{ atom.rating.toFixed(1) }} <small>({{ atom.rating_count }})</small></strong></div>
        <div><span>Versions</span><strong>{{ atom.versions.length }}</strong></div>
        <div><span>Latest</span><strong>{{ atom.versions[0]?.version }}</strong></div>
      </div>

      <!-- Tabs -->
      <div class="wp-comm-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="wp-comm-tab"
          role="tab"
          :data-active="tab === t.key"
          :aria-selected="tab === t.key"
          @click="tab = t.key"
        >{{ t.label }}<template v-if="t.key === 'reviews'"> · {{ atom.comments?.length ?? 0 }}</template></button>
      </div>

      <div class="wp-comm-tabbody">
        <div
          v-if="tab === 'readme'"
          class="wp-comm-readme"
          v-html="renderedReadme"
        />

        <div v-else-if="tab === 'preview'">
          <template v-if="previewKind === 'bundle'">
            <h3>What's in this pack</h3>
            <div class="wp-comm-grid">
              <div v-for="kind in bundleSubKinds()" :key="kind" class="wp-comm-card">
                <div class="wp-comm-card__body" style="display:flex; flex-direction:row; align-items:center; gap:8px;">
                  <i :class="['pi', KIND_ICON[kind]]" aria-hidden="true" />
                  <span>{{ KIND_LABEL[kind] }}</span>
                </div>
              </div>
            </div>
            <h3 style="margin-top: 16px;">Sample resolutions</h3>
            <div class="wp-comm-readme">
              <ul>
                <li v-for="(s, i) in bundleSamples()" :key="i">{{ s }}</li>
              </ul>
            </div>
          </template>
          <template v-else>
            <h3>Options &amp; weight distribution</h3>
            <div class="wp-comm-readme">
              <div v-for="(opt, i) in previewOptions()" :key="i" class="wp-comm-histo-row">
                <span class="wp-comm-histo-row__val">{{ opt.value }}</span>
                <div class="wp-comm-histo-row__bar">
                  <div :style="{ width: ((opt.weight / previewTotal) * 100) + '%' }" />
                </div>
                <span class="wp-comm-histo-row__pct">{{ Math.round((opt.weight / previewTotal) * 100) }}%</span>
              </div>
              <p v-if="!previewOptions().length" class="text-muted">No preview shape provided.</p>
            </div>
          </template>
        </div>

        <div v-else-if="tab === 'versions'" class="wp-comm-versions">
          <div
            v-for="v in changelog()"
            :key="v.version"
            class="wp-comm-version"
            :data-active="selectedVersion === v.version"
          >
            <button
              type="button"
              class="wp-comm-version__head"
              @click="selectedVersion = v.version"
            >
              <span><strong>{{ v.version }}</strong></span>
              <span class="wp-comm-version__date">{{ relativeTime(v.published_at) }}</span>
            </button>
            <p class="wp-comm-version__notes">{{ v.changelog || "(no notes)" }}</p>
          </div>
        </div>

        <div v-else-if="tab === 'reviews'" class="wp-comm-reviews">
          <div class="wp-comm-reviews__summary">
            <div>
              <div class="wp-comm-reviews__big-num">{{ atom.rating.toFixed(1) }}</div>
              <div style="color: var(--wp-text-muted); font-size: 12px;">{{ atom.rating_count }} reviews</div>
            </div>
            <div class="wp-comm-reviews__bars">
              <div v-for="(n, i) in atom.rating_dist" :key="i" class="wp-comm-reviews__bar">
                <span style="width: 16px;">{{ 5 - i }}★</span>
                <div class="wp-comm-reviews__bar-track">
                  <div :style="{ width: ((n / Math.max(...atom.rating_dist, 1)) * 100) + '%' }" />
                </div>
                <span style="width: 36px; text-align: right; color: var(--wp-text-muted);">{{ n }}</span>
              </div>
            </div>
          </div>

          <div v-if="atom.comments && atom.comments.length">
            <div v-for="cm in atom.comments" :key="cm.id" class="wp-comm-review">
              <div class="wp-comm-review__head">
                <span
                  class="wp-comm-card__avatar"
                  :style="{ backgroundImage: `url(${cm.user.avatar_url})` }"
                  aria-hidden="true"
                />
                <strong>{{ cm.user.name || cm.user.login }}</strong>
                <span>@{{ cm.user.login }}</span>
                <span style="margin-left: auto;">{{ relativeTime(cm.at) }}</span>
              </div>
              <p class="wp-comm-review__text">{{ cm.body }}</p>
            </div>
          </div>
          <p v-else class="text-muted">No reviews yet — be the first.</p>

          <div v-if="store.currentUser" class="wp-comm-review">
            <p style="margin: 0; color: var(--wp-text-muted); font-size: 12px;">
              Reviewing as <strong>@{{ store.currentUser.login }}</strong> — full review form lands with backend hookup.
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

.self-start { align-self: flex-start; }
.grow { flex: 1; min-width: 240px; }
.text-muted { color: var(--wp-text-muted); font-size: 12px; }
</style>
