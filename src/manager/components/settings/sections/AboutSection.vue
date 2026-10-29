<script setup lang="ts">
import Icon from "../../../../kit/Icon.vue";
import SupportLinks from "../../../../kit/SupportLinks.vue";
import SettingGroup from "../SettingGroup.vue";
import SettingRow from "../SettingRow.vue";
import { DISCORD_INVITE, GITHUB_REPO, KIT_SITE, SUPPORT_LINKS, WPC_API_URL, kitVersion } from "../../../config/links";

// Build-time injected via vite `define` (see vite.config.mts) — source of
// truth is package.json, which the release PR stamps on every release.
const appVersion = __APP_VERSION__;
const appLicense = __APP_LICENSE__;
// The wp-kit commit src/kit/ was pulled at, from src/kit/kit.lock.json.
const kit = kitVersion(__KIT_VERSION__);
</script>

<template>
  <SettingGroup title="About">
    <SettingRow label="Wildcard Pipeline" setting-key="about" stacked>
      <div class="wp-set-about">
        <span class="wp-dim">Version</span><span class="wp-mono">{{ appVersion }}</span>
        <span class="wp-dim">License</span><span class="wp-mono">{{ appLicense }}</span>
        <span class="wp-dim">Component kit</span>
        <span class="wp-set-about__kit">
          <a class="wp-set-about__link wp-mono" :href="kit.href" target="_blank" rel="noopener" data-test="about-kit-version">wp-kit {{ kit.label }}</a>
          <a class="wp-set-about__link" :href="KIT_SITE" target="_blank" rel="noopener" data-test="about-kit-site">See every piece</a>
        </span>
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
      <SupportLinks :links="SUPPORT_LINKS" class="wp-set-support" data-test="settings-support" />
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
.wp-set-about__kit { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-2) var(--wp-space-5); min-width: 0; }

.wp-set-support { flex: 1 1 100%; }

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
