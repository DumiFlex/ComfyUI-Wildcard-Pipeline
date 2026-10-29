<script setup lang="ts">
import Icon from "../../../../kit/Icon.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { DISCORD_INVITE, GITHUB_REPO, SUPPORT_LINKS, WPC_API_URL } from "../../../config/links";

// Build-time injected via vite `define` (see vite.config.mts) — source of
// truth is package.json, which semantic-release stamps on every release.
const appVersion = __APP_VERSION__;
const appLicense = __APP_LICENSE__;
</script>

<template>
  <SettingGroup title="About">
    <SettingRow label="Wildcard Pipeline" setting-key="about" stacked>
      <div class="wp-set-about">
        <span class="wp-dim">Version</span><span class="wp-mono">{{ appVersion }}</span>
        <span class="wp-dim">License</span><span class="wp-mono">{{ appLicense }}</span>
        <span class="wp-dim">Repository</span>
        <a class="wp-set-about__link wp-mono" :href="GITHUB_REPO" target="_blank" rel="noopener">
          <Icon name="pi-github" /> {{ GITHUB_REPO }}
        </a>
        <span class="wp-dim">Made by</span>
        <a class="wp-set-about__link" href="https://github.com/DumiFlex" target="_blank" rel="noopener">DumiFlex</a>
      </div>
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="Support the project">
    <SettingRow
      label="Support the project"
      hint="Wildcard Pipeline is free and made by one person, with no paid tier. If it helps you, a donation keeps it going: bug fixes, docs and new features."
      setting-key="support"
      stacked
    >
      <ul class="wp-support" data-test="settings-support">
        <li v-for="link in SUPPORT_LINKS" :key="link.id">
          <a
            class="wp-support__link"
            :data-kind="link.id"
            :href="link.href"
            target="_blank"
            rel="noopener"
            :data-test="`settings-support-${link.id}`"
          >
            <span class="wp-support__icon"><Icon :name="link.icon" :size="16" /></span>
            <span class="wp-support__text">
              <span class="wp-support__label">{{ link.label }}</span>
              <span class="wp-support__detail">{{ link.detail }}</span>
            </span>
            <Icon name="pi-external-link" class="wp-support__out" :size="12" />
          </a>
        </li>
      </ul>
    </SettingRow>
    <SettingRow
      label="Other ways to help"
      hint="Free and just as welcome."
      setting-key="help-out"
      stacked
    >
      <ul class="wp-set-help">
        <li>
          <a class="wp-set-about__link" :href="GITHUB_REPO" target="_blank" rel="noopener"><Icon name="pi-star" /> Star the repo on GitHub</a>
          <span class="wp-dim">so others can find it.</span>
        </li>
        <li>
          <a class="wp-set-about__link" :href="DISCORD_INVITE" target="_blank" rel="noopener"><Icon name="pi-discord" /> Join the Discord</a>
          <span class="wp-dim">to ask, report bugs and show what you made.</span>
        </li>
        <li>
          <a class="wp-set-about__link" :href="WPC_API_URL" target="_blank" rel="noopener"><Icon name="pi-share-alt" /> Share your modules</a>
          <span class="wp-dim">on the community site.</span>
        </li>
      </ul>
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-set-about {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--wp-space-3) var(--wp-space-6);
  min-width: 0;
  font-size: var(--wp-text-sm);
  align-items: center;
}
.wp-set-about__link {
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  min-width: 0;
  /* The long address wraps instead of pushing the card wider than the page. */
  overflow-wrap: anywhere;
}
.wp-set-about__link:hover { color: var(--wp-text); }

.wp-support {
  flex: 1 1 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--wp-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}
.wp-support__link {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  height: 100%;
  box-sizing: border-box;
  padding: var(--wp-space-4) var(--wp-space-5);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md, 8px);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  text-decoration: none;
  transition: border-color 120ms ease-out, background-color 120ms ease-out;
}
.wp-support__link:hover {
  border-color: var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 8%, var(--wp-bg-1));
}
.wp-support__link:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}
.wp-support__icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--wp-radius-md, 8px);
  background: var(--wp-bg-2);
  color: var(--wp-accent-text);
}
.wp-support__text { display: grid; gap: 2px; min-width: 0; flex: 1; }
.wp-support__label { font-weight: 600; font-size: var(--wp-text-sm); }
.wp-support__detail { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-support__out { color: var(--wp-text-dim); flex: none; }

.wp-set-help {
  display: grid;
  gap: var(--wp-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--wp-text-sm);
}
.wp-set-help li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-3); }
</style>
