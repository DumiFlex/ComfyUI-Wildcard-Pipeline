import { createApp } from "vue";
import { createPinia } from "pinia";
import "primeicons/primeicons.css";
import "./styles/tokens.css";
import "./styles/rich-text.css";
import "./styles/tailwind.css";
import App from "./App.vue";
import router from "./router";
import { useUiStore } from "./stores/uiStore";
import { useTweaksStore } from "./stores/tweaksStore";
import { api as managerApi } from "./api/client";
import {
  CURRENT_SCHEMA_VERSION,
  installEnvelope,
  type InstallResult,
} from "./import-export/install";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Apply persisted theme before mount so the first paint is correct.
// `useUiStore` reads localStorage and listens to OS preference changes.
useUiStore(pinia).initializeTheme();
// Apply persisted runtime tweaks (accent palette, density) before mount so
// CSS-var overrides land before the first paint and we don't flash defaults.
useTweaksStore(pinia).initialize();
app.mount("#app");

/* ────────────────────────────────────────────────────────────────
   Host-bridge: window.__wpcRuntime
   ────────────────────────────────────────────────────────────────
   The community embed bundle (loaded from wp.dumiflex.dev via the
   Community tab) detects this global at runtime and calls
   `install(envelope)` to drop a pack into the live library directly
   — no file download + manual Import tab round-trip.

   `abi` is a coarse version on the bridge contract itself. Bump
   when the shape changes incompatibly (add a field = no bump; remove
   or rename a field = bump). `schemaVersion` is the entity-payload
   schema the engine accepts today. The embed compares its envelope's
   `schema_version` to this number: greater = "update extension to
   install"; less or equal = migrations run during install.

   Threat model: same-origin globals are readable by every script
   running in this document — other ComfyUI extensions already have
   that access via Vue/Pinia imports, so this doesn't widen the
   surface. The user is expected to confirm before each install
   (the embed shows a dialog), and the install pipeline runs the
   same integrity + migration checks the Import tab uses, so a
   malformed payload from any source fails the same way.
   ────────────────────────────────────────────────────────────── */
declare global {
  interface Window {
    __wpcRuntime?: {
      abi: number;
      schemaVersion: number;
      install: (envelope: unknown) => Promise<InstallResult>;
    };
  }
}
window.__wpcRuntime = {
  abi: 1,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  install: (envelope) => installEnvelope(
    { envelope },
    { importExport: managerApi.importExport },
  ),
};
