<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import Menu from "primevue/menu";
import { useRoute, useRouter } from "vue-router";
import { useUiStore } from "../stores/uiStore";
import { useCommunityStore } from "../stores/communityStore";

const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const community = useCommunityStore();
const version = "1.4.0-dev";
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;

/** Icon for the theme button reflects the *next* state in the cycle. */
const themeIcon = computed(() => {
  switch (ui.themeMode) {
    case "dark":  return "pi pi-sun";        // next: light
    case "light": return "pi pi-desktop";    // next: auto
    default:      return "pi pi-moon";       // next: dark
  }
});
const themeLabel = computed(() =>
  ui.themeMode === "dark"  ? "Switch to light theme" :
  ui.themeMode === "light" ? "Switch to auto (system) theme" :
                             "Switch to dark theme",
);

/** Status + user pill render only when the user is on a community route. */
const onCommunity = computed(() => (route.path || "").startsWith("/community"));

const statusColor = computed(() => {
  if (community.apiStatus === "online")   return "var(--wp-success)";
  if (community.apiStatus === "degraded") return "var(--wp-warn)";
  return "var(--wp-danger)";
});

const userMenu = ref<InstanceType<typeof Menu> | null>(null);
const userMenuItems = computed(() => [
  { label: "My profile", icon: "pi pi-user", command: () => router.push("/community/profile") },
  { label: "Sign out",   icon: "pi pi-sign-out", command: () => community.signOut() },
]);
function toggleUserMenu(event: Event) {
  userMenu.value?.toggle(event);
}

async function onSignIn() {
  try {
    await community.signIn();
  } catch {
    /* mockApi surfaces error via apiStatus */
  }
}

onMounted(() => {
  // Lazy probe — ensures the dot reflects current state on community routes.
  if (onCommunity.value) community.refreshApiStatus();
});
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <Button
        icon="pi pi-bars" text rounded severity="secondary"
        aria-label="Toggle menu"
        @click="ui.toggleSidebar"
      />
      <RouterLink to="/" class="brand">
        <img :src="logoSrc" alt="" class="brand-logo" />
        <span class="brand-name">Wildcard Pipeline</span>
        <span class="brand-version">v{{ version }}</span>
      </RouterLink>
    </div>
    <div class="topbar-right">
      <span
        v-if="onCommunity"
        class="topbar-status"
        :title="`Community API: ${community.apiStatus}`"
      >
        <span class="topbar-status__dot" :style="{ background: statusColor }" />
        <span class="topbar-status__label">{{ community.apiStatus }}</span>
      </span>
      <Button
        :icon="themeIcon" text rounded severity="secondary"
        :aria-label="themeLabel"
        :title="themeLabel"
        @click="ui.cycleTheme"
      />
      <template v-if="onCommunity">
        <button
          v-if="community.currentUser"
          type="button"
          class="topbar-user"
          aria-haspopup="true"
          aria-controls="topbar-user-menu"
          :title="`Signed in as @${community.currentUser.login}`"
          @click="toggleUserMenu"
        >
          <span
            class="topbar-user__avatar"
            :style="{ backgroundImage: `url(${community.currentUser.avatar_url})` }"
            aria-hidden="true"
          />
          <span class="topbar-user__login">@{{ community.currentUser.login }}</span>
          <i class="pi pi-chevron-down topbar-user__caret" aria-hidden="true" />
        </button>
        <Menu
          v-if="community.currentUser"
          id="topbar-user-menu"
          ref="userMenu"
          :model="userMenuItems"
          :popup="true"
        />
        <Button
          v-else
          label="Sign in with GitHub"
          icon="pi pi-github"
          severity="secondary"
          outlined
          @click="onSignIn"
        />
      </template>
      <Button
        icon="pi pi-cog" text rounded severity="secondary"
        aria-label="Settings"
        @click="router.push('/settings')"
      />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--wp-topbar-h, 56px);
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  position: sticky;
  top: 0;
  z-index: 10;
}
.topbar-left, .topbar-right { display: flex; align-items: center; gap: 8px; }
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--wp-text);
  font-weight: 600;
}
.brand:hover { color: var(--wp-text); filter: brightness(1.1); }
.brand-logo { width: 24px; height: 24px; }
.brand-name { letter-spacing: 0.2px; }
.brand-version {
  font-size: 11px;
  color: var(--wp-text-dim, var(--wp-text3));
  font-weight: 400;
}

/* Community-only chrome */
.topbar-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--wp-bg-2);
  font-size: 11px;
  color: var(--wp-text-muted);
}
.topbar-status__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
}
.topbar-status__label { text-transform: capitalize; }
.topbar-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  padding: 2px 10px 2px 2px;
  cursor: pointer;
  font: inherit;
  color: var(--wp-text);
}
.topbar-user:hover { background: var(--wp-bg-3); }
.topbar-user__avatar {
  width: 22px; height: 22px;
  border-radius: 999px;
  background-size: cover;
  background-position: center;
  background-color: var(--wp-bg-3);
  display: inline-block;
}
.topbar-user__login {
  font-size: 12px;
}
.topbar-user__caret {
  font-size: 10px;
  color: var(--wp-text-muted);
}
</style>
