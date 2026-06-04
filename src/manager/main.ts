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
  type CollisionDecision,
  type InstallCollision,
  type InstallOrigin,
  type InstallResult,
  type LibrarySnapshot,
} from "./import-export/install";
import { useModuleStore } from "./stores/moduleStore";
import { useBundleStore } from "./stores/bundleStore";

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
      install: (
        envelope: unknown,
        opts?: {
          /** Called when client-side collision detection finds duplicates.
           *  Receives one row per conflict. Returning null cancels the
           *  install. The embed wires this to its own modal. */
          resolveCollisions?: (
            rows: InstallCollision[],
          ) => Promise<Record<string, CollisionDecision> | null>;
          /** Tag every inserted entity with this community origin so
           *  the SPA can surface "installed from @author/pack" + drive
           *  update-available checks. Embed passes {post_slug,
           *  version_number} when invoking install via the community
           *  Install / Install vN buttons. */
          origin?: InstallOrigin;
        },
      ) => Promise<InstallResult>;
    };
  }
}

/**
 * Snapshot Pinia stores into the LibrarySnapshot shape installEnvelope
 * expects. Called fresh per `install()` invocation so a long-lived
 * embed picks up library state mutations between installs.
 */
function snapshotLibrary(): LibrarySnapshot {
  const moduleStore = useModuleStore();
  const bundleStore = useBundleStore();
  const modules = new Map<string, { id: string; name: string }>();
  for (const m of moduleStore.catalog) {
    modules.set(m.id, { id: m.id, name: m.name });
  }
  const bundles = new Map<string, { id: string; name: string }>();
  for (const b of bundleStore.catalog) {
    bundles.set(b.id, { id: b.id, name: b.name });
  }
  return { modules, bundles };
}

window.__wpcRuntime = {
  // ABI stays at 1: the install signature only gained an optional 2nd
  // argument, which old callers passing a single argument continue to
  // satisfy. Bump only if a future change removes/renames a field.
  abi: 1,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  install: (envelope, opts) => installEnvelope(
    { envelope },
    {
      importExport: managerApi.importExport,
      library: snapshotLibrary(),
      ...(opts?.resolveCollisions ? { resolveCollisions: opts.resolveCollisions } : {}),
      ...(opts?.origin ? { origin: opts.origin } : {}),
    },
  ),
};
