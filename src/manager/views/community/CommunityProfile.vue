<script setup lang="ts">
/**
 * Community → Profile screen.
 *
 * Sections: My uploads, Starred modules, Installed modules, Install history.
 * All sourced from the community store + the in-memory mock catalog.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../../components/ui/Button.vue";
import { useCommunityStore } from "../../stores/communityStore";
import CommunityCard from "../../community/CommunityCard.vue";
import { findInCatalog } from "../../community/mockApi";
import { relativeTime } from "../../community/format";
import type { CommunityAtom } from "../../community/types";

const router = useRouter();
const store = useCommunityStore();

const tab = ref<"uploads" | "starred" | "installed" | "history">("uploads");

const uploadAtoms = computed<CommunityAtom[]>(() =>
  Array.from(store.myUploads)
    .map((id) => findInCatalog(id))
    .filter((atom): atom is CommunityAtom => Boolean(atom)),
);
const starredAtoms = computed<CommunityAtom[]>(() =>
  Array.from(store.starred)
    .map((id) => findInCatalog(id))
    .filter((atom): atom is CommunityAtom => Boolean(atom)),
);
const installedAtoms = computed<CommunityAtom[]>(() =>
  Array.from(store.installed)
    .map((id) => findInCatalog(id))
    .filter((atom): atom is CommunityAtom => Boolean(atom)),
);

const tabs = computed(() => [
  { key: "uploads",   label: `My uploads · ${uploadAtoms.value.length}` },
  { key: "starred",   label: `Starred · ${starredAtoms.value.length}` },
  { key: "installed", label: `Installed · ${installedAtoms.value.length}` },
  { key: "history",   label: `History · ${store.installHistory.length}` },
] as const);

function back() {
  router.push({ name: "community-discover" });
}

onMounted(() => {
  if (!store.currentUser) return;
});
</script>

<template>
  <div class="wp-comm-page">
    <Button
      variant="ghost"
      icon="arrow-left"
      class="wp-comm-back"
      @click="back"
    >Back to Community</Button>

    <div v-if="!store.currentUser" class="wp-empty wp-empty--card">
      <i class="pi pi-user wp-empty__icon" aria-hidden="true" />
      <h3>Sign in to view your profile</h3>
      <p>Use the GitHub button in the topbar to sign in (mock).</p>
    </div>

    <template v-else>
      <section class="wp-comm-profile-hero">
        <div
          class="wp-comm-profile-avatar"
          :style="{ backgroundImage: `url(${store.currentUser.avatar_url})` }"
          aria-hidden="true"
        />
        <div class="wp-comm-profile-meta">
          <h1 class="wp-comm-profile-name">{{ store.currentUser.name || store.currentUser.login }}</h1>
          <div class="wp-comm-profile-handle">@{{ store.currentUser.login }} · joined just now</div>
          <div class="wp-comm-profile-stats">
            <div><strong>{{ uploadAtoms.length }}</strong><span>Uploads</span></div>
            <div><strong>{{ starredAtoms.length }}</strong><span>Stars</span></div>
            <div><strong>{{ installedAtoms.length }}</strong><span>Installed</span></div>
            <div><strong>{{ store.installHistory.length }}</strong><span>Install history</span></div>
          </div>
        </div>
        <div class="wp-comm-profile-actions">
          <Button variant="primary" icon="upload" @click="router.push('/community/upload')">Publish</Button>
          <Button variant="outline" icon="sign-out" @click="store.signOut()">Sign out</Button>
        </div>
      </section>

      <div class="wp-comm-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          type="button"
          class="wp-comm-tab"
          role="tab"
          :data-active="tab === t.key"
          @click="tab = t.key"
        >{{ t.label }}</button>
      </div>

      <div class="wp-comm-tabbody">
        <div v-if="tab === 'uploads'">
          <div v-if="!uploadAtoms.length" class="wp-empty wp-empty--card">
            <i class="pi pi-upload wp-empty__icon" aria-hidden="true" />
            <h3>You haven't published anything yet.</h3>
            <Button class="wp-empty__cta" variant="primary" icon="upload" @click="router.push('/community/upload')">Publish a module</Button>
          </div>
          <div v-else class="wp-comm-grid">
            <CommunityCard v-for="atom in uploadAtoms" :key="atom.id" :atom="atom" />
          </div>
        </div>

        <div v-if="tab === 'starred'">
          <div v-if="!starredAtoms.length" class="wp-empty wp-empty--card">
            <i class="pi pi-star wp-empty__icon" aria-hidden="true" />
            <h3>No starred modules yet.</h3>
            <p>Star modules to save them for later.</p>
          </div>
          <div v-else class="wp-comm-grid">
            <CommunityCard v-for="atom in starredAtoms" :key="atom.id" :atom="atom" />
          </div>
        </div>

        <div v-if="tab === 'installed'">
          <div v-if="!installedAtoms.length" class="wp-empty wp-empty--card">
            <i class="pi pi-download wp-empty__icon" aria-hidden="true" />
            <h3>No modules installed from the registry.</h3>
            <p>Browse Community to find some.</p>
          </div>
          <div v-else class="wp-comm-grid">
            <CommunityCard v-for="atom in installedAtoms" :key="atom.id" :atom="atom" />
          </div>
        </div>

        <div v-if="tab === 'history'">
          <div v-if="!store.installHistory.length" class="wp-empty wp-empty--card">
            <i class="pi pi-clock wp-empty__icon" aria-hidden="true" />
            <h3>No install history yet.</h3>
          </div>
          <table v-else class="history-table">
            <thead>
              <tr><th>Module</th><th>Installed</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="entry in store.installHistory" :key="entry.id + entry.at">
                <td>
                  <button
                    type="button"
                    class="link-btn"
                    @click="router.push({ name: 'community-detail', params: { id: entry.id } })"
                  >{{ findInCatalog(entry.id)?.name || entry.id }}</button>
                </td>
                <td class="history-table__when">{{ relativeTime(entry.at) }}</td>
                <td class="history-table__action">
                  <Button
                    variant="ghost"
                    @click="router.push({ name: 'community-detail', params: { id: entry.id } })"
                  >Open</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import "../../community/community.css";

.wp-comm-back { align-self: flex-start; }

/* Profile hero — extracted from prior inline `style="..."` clusters so the
   layout is debuggable and tweakable without touching the template. Values
   here mirror the previous inline styles exactly to keep the visual a
   byte-for-byte no-op (h1 zeroed margin, handle muted, stats keep their
   own margin-top). */
.wp-comm-profile-meta { flex: 1; }
.wp-comm-profile-name { margin: 0; }
.wp-comm-profile-handle { color: var(--wp-text-muted); }
.wp-comm-profile-actions {
  display: flex;
  gap: 8px;
}

/* Empty-state CTA — replaces the `mt-3` utility leak. */
.wp-empty__cta { margin-top: 12px; }

.history-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  overflow: hidden;
}
.history-table th, .history-table td {
  padding: 10px 12px;
  text-align: left;
  font-size: 12.5px;
}
.history-table thead { background: var(--wp-bg-2); }
.history-table tr + tr td { border-top: 1px solid var(--wp-border); }
.history-table__when { color: var(--wp-text-muted); }
.history-table__action { text-align: right; }
.link-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--wp-accent-text);
  cursor: pointer;
  text-decoration: underline;
}
</style>
