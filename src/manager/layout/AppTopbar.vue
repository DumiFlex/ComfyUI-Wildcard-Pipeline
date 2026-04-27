<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Icon from "../components/ui/Icon.vue";
import { useUiStore } from "../stores/uiStore";
import { useCommunityStore } from "../stores/communityStore";
import { useTweaksStore } from "../stores/tweaksStore";

const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const community = useCommunityStore();
const tweaks = useTweaksStore();

const version = "1.4.0-dev";
const logoSrc = `${import.meta.env.BASE_URL}images/favicon.svg`;

/** Theme button icon — mirrors prototype (current state, not next). */
const themeIcon = computed(() => {
  switch (ui.themeMode) {
    case "light": return "pi-sun";
    case "dark":  return "pi-moon";
    default:      return "pi-desktop";
  }
});
const themeLabel = computed(() => `Theme: ${ui.themeMode}`);

/** Status pill + user pill render only on community routes. */
const onCommunity = computed(() => (route.path || "").startsWith("/community"));

const statusColor = computed(() => {
  if (community.apiStatus === "online")   return "var(--wp-success, #10b981)";
  if (community.apiStatus === "degraded") return "var(--wp-warn, #f59e0b)";
  return "var(--wp-danger, #ef4444)";
});

/* User dropdown — outside-click closes it. */
const userMenuOpen = ref(false);
const userMenuRef = ref<HTMLDivElement | null>(null);

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value;
}
function closeUserMenu() {
  userMenuOpen.value = false;
}
function onProfile() {
  closeUserMenu();
  router.push("/community/profile");
}
async function onSignOut() {
  closeUserMenu();
  await community.signOut();
}
async function onSignIn() {
  try {
    await community.signIn();
  } catch {
    /* mockApi surfaces error via apiStatus */
  }
}

function onDocumentClick(event: MouseEvent) {
  if (!userMenuOpen.value) return;
  const el = userMenuRef.value;
  if (el && event.target instanceof Node && !el.contains(event.target)) {
    closeUserMenu();
  }
}

onMounted(() => {
  if (onCommunity.value) community.refreshApiStatus();
  document.addEventListener("click", onDocumentClick);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <header class="wp-topbar">
    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Toggle sidebar"
      data-test="topbar-toggle"
      @click="ui.toggleSidebar"
    >
      <Icon name="pi-bars" />
    </button>

    <RouterLink to="/" class="wp-topbar__brand" data-test="topbar-brand">
      <img :src="logoSrc" alt="" />
      <span>Wildcard Pipeline</span>
      <span class="wp-topbar__version">v{{ version }}</span>
    </RouterLink>

    <div class="wp-topbar__spacer" />

    <span
      v-if="onCommunity"
      class="wp-topbar-status"
      :title="`Community API: ${community.apiStatus}`"
      data-test="topbar-status"
    >
      <span class="wp-topbar-status__dot" :style="{ background: statusColor }" />
      <span class="wp-topbar-status__label">{{ community.apiStatus }}</span>
    </span>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      :aria-label="themeLabel"
      :title="themeLabel"
      data-test="topbar-theme"
      @click="ui.cycleTheme"
    >
      <Icon :name="themeIcon" />
    </button>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Tweaks"
      title="Tweaks"
      data-test="topbar-tweaks"
      @click="tweaks.togglePanel"
    >
      <Icon name="pi-sliders-h" />
    </button>

    <template v-if="onCommunity">
      <div
        v-if="community.currentUser"
        ref="userMenuRef"
        class="wp-topbar-user-wrap"
      >
        <button
          type="button"
          class="wp-topbar-user"
          aria-haspopup="menu"
          :aria-expanded="userMenuOpen"
          :title="`Signed in as @${community.currentUser.login}`"
          data-test="topbar-user"
          @click.stop="toggleUserMenu"
        >
          <span
            class="wp-topbar-user__avatar"
            :style="{ backgroundImage: `url(${community.currentUser.avatar_url})` }"
            aria-hidden="true"
          />
          <span class="wp-topbar-user__login">@{{ community.currentUser.login }}</span>
          <Icon name="pi-chevron-down" :size="10" />
        </button>
        <div
          v-if="userMenuOpen"
          class="wp-topbar-user__menu"
          role="menu"
          data-test="topbar-user-menu"
        >
          <button type="button" class="wp-topbar-user__item" role="menuitem" @click="onProfile">
            <Icon name="pi-user" />
            <span>My profile</span>
          </button>
          <button type="button" class="wp-topbar-user__item" role="menuitem" @click="onSignOut">
            <Icon name="pi-sign-out" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
      <Button
        v-else
        variant="outline"
        icon="pi-github"
        data-test="topbar-signin"
        @click="onSignIn"
      >
        Sign in with GitHub
      </Button>
    </template>

    <button
      type="button"
      class="wp-topbar__icon-btn"
      aria-label="Settings"
      title="Settings"
      data-test="topbar-settings"
      @click="router.push('/settings')"
    >
      <Icon name="pi-cog" />
    </button>
  </header>
</template>

<style scoped>
/* Layout for things not already covered by tokens.css.
   .wp-topbar, .wp-topbar__brand, .wp-topbar__version, .wp-topbar__spacer,
   .wp-topbar__icon-btn are all defined globally in tokens.css. */

.wp-topbar-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--wp-bg-2);
  font-size: 11px;
  color: var(--wp-text-muted);
}
.wp-topbar-status__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  display: inline-block;
}
.wp-topbar-status__label { text-transform: capitalize; }

.wp-topbar-user-wrap { position: relative; }
.wp-topbar-user {
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
.wp-topbar-user:hover { background: var(--wp-bg-3); }
.wp-topbar-user__avatar {
  width: 22px; height: 22px;
  border-radius: 999px;
  background-size: cover;
  background-position: center;
  background-color: var(--wp-bg-3);
  display: inline-block;
}
.wp-topbar-user__login { font-size: 12px; }

.wp-topbar-user__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 4px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-topbar-user__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: var(--wp-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.wp-topbar-user__item:hover { background: var(--wp-bg-3); }
</style>
