<script setup lang="ts">
/**
 * Community → Profile screen.
 *
 * Sections: My uploads, Starred modules, Installed modules, Install history.
 * All sourced from the community store + the in-memory mock catalog.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
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
      label="Back to Community"
      icon="pi pi-arrow-left"
      severity="secondary"
      text
      class="self-start"
      @click="back"
    />

    <div v-if="!store.currentUser" class="wp-comm-empty">
      <i class="pi pi-user wp-comm-empty__icon" aria-hidden="true" />
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
        <div style="flex: 1;">
          <h1 style="margin: 0;">{{ store.currentUser.name || store.currentUser.login }}</h1>
          <div style="color: var(--wp-text-muted);">@{{ store.currentUser.login }} · joined just now</div>
          <div class="wp-comm-profile-stats">
            <div><strong>{{ uploadAtoms.length }}</strong><span>Uploads</span></div>
            <div><strong>{{ starredAtoms.length }}</strong><span>Stars</span></div>
            <div><strong>{{ installedAtoms.length }}</strong><span>Installed</span></div>
            <div><strong>{{ store.installHistory.length }}</strong><span>Install history</span></div>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <Button label="Publish" icon="pi pi-upload" @click="router.push('/community/upload')" />
          <Button label="Sign out" icon="pi pi-sign-out" severity="secondary" outlined @click="store.signOut()" />
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
          <div v-if="!uploadAtoms.length" class="wp-comm-empty">
            <i class="pi pi-upload wp-comm-empty__icon" aria-hidden="true" />
            <h3>You haven't published anything yet.</h3>
            <Button class="mt-3" label="Publish a module" icon="pi pi-upload" @click="router.push('/community/upload')" />
          </div>
          <div v-else class="wp-comm-grid">
            <CommunityCard v-for="atom in uploadAtoms" :key="atom.id" :atom="atom" />
          </div>
        </div>

        <div v-if="tab === 'starred'">
          <div v-if="!starredAtoms.length" class="wp-comm-empty">
            <i class="pi pi-star wp-comm-empty__icon" aria-hidden="true" />
            <h3>No starred modules yet.</h3>
            <p>Star modules to save them for later.</p>
          </div>
          <div v-else class="wp-comm-grid">
            <CommunityCard v-for="atom in starredAtoms" :key="atom.id" :atom="atom" />
          </div>
        </div>

        <div v-if="tab === 'installed'">
          <div v-if="!installedAtoms.length" class="wp-comm-empty">
            <i class="pi pi-download wp-comm-empty__icon" aria-hidden="true" />
            <h3>No modules installed from the registry.</h3>
            <p>Browse Community to find some.</p>
          </div>
          <div v-else class="wp-comm-grid">
            <CommunityCard v-for="atom in installedAtoms" :key="atom.id" :atom="atom" />
          </div>
        </div>

        <div v-if="tab === 'history'">
          <div v-if="!store.installHistory.length" class="wp-comm-empty">
            <i class="pi pi-clock wp-comm-empty__icon" aria-hidden="true" />
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
                <td style="color: var(--wp-text-muted);">{{ relativeTime(entry.at) }}</td>
                <td style="text-align: right;">
                  <Button
                    label="Open"
                    severity="secondary"
                    text
                    @click="router.push({ name: 'community-detail', params: { id: entry.id } })"
                  />
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

.self-start { align-self: flex-start; }
.mt-3 { margin-top: 12px; }
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
