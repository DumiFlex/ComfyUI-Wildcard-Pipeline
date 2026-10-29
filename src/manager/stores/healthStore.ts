/**
 * Library health: the latest scan of the whole library (`/wp/api/health`),
 * the findings the user ignored, and the community-update rows folded in.
 *
 * The scan asks any open canvas tab what it uses first (canvas-facts
 * channel), so items placed only on that canvas don't read as unused. It
 * runs once when something first reads the store (the sidebar badge), then
 * again a moment after the library changes, so the badge stays current
 * without anyone opening the page.
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import type {
  HealthCheckInfo,
  HealthFinding,
  HealthScan,
  HealthSeverity,
} from "../api/types";
import { libraryVersion } from "../composables/useLibraryChanged";
import { askCanvasFacts } from "../utils/ai-context";
import { useBundleStore } from "./bundleStore";
import { useCategoryStore } from "./categoryStore";
import { useCommunityUpdateStore } from "./communityUpdateStore";
import { useModuleStore } from "./moduleStore";
import { useTemplateStore } from "./templateStore";

/** The client-side check: the server can't see the community catalog. */
export const COMMUNITY_CHECK: HealthCheckInfo = {
  id: "community_update",
  severity: "tidy",
  title: "Newer version on Community",
};

/** How long after a library change the scan waits, so a bulk edit scans once. */
const RESCAN_MS = 800;

export const useHealthStore = defineStore("health", () => {
  const moduleStore = useModuleStore();
  const bundleStore = useBundleStore();
  const templateStore = useTemplateStore();
  const categoryStore = useCategoryStore();
  const communityUpdates = useCommunityUpdateStore();

  const scan = ref<HealthScan | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const ignored = ref<Set<string>>(new Set());
  let started = false;
  let pending: Promise<void> | null = null;
  let again = false;

  const communityFindings = computed<HealthFinding[]>(() => {
    const out: HealthFinding[] = [];
    for (const e of communityUpdates.updatesByEntityId.values()) {
      const row = e.entity_kind === "bundle"
        ? bundleStore.catalog.find((b) => b.id === e.entity_id)
        : moduleStore.catalog.find((m) => m.id === e.entity_id);
      if (!row) continue;
      const type = e.entity_kind === "bundle" ? "bundle" : (row as { type?: string }).type ?? "module";
      out.push({
        check: COMMUNITY_CHECK.id,
        severity: COMMUNITY_CHECK.severity,
        key: `${COMMUNITY_CHECK.id}:${e.entity_kind}:${e.entity_id}:${e.latest_version}`,
        item: { kind: e.entity_kind, id: e.entity_id, name: row.name, type },
        detail: `You have version ${e.installed_version}; version ${e.latest_version} is on Community.`,
      });
    }
    return out;
  });

  const findings = computed<HealthFinding[]>(() => [
    ...(scan.value?.findings ?? []),
    ...communityFindings.value,
  ]);

  const checks = computed<HealthCheckInfo[]>(() => [
    ...(scan.value?.checks ?? []),
    COMMUNITY_CHECK,
  ]);

  const counts = computed<Record<HealthSeverity, number>>(() => {
    const out: Record<HealthSeverity, number> = { problem: 0, warning: 0, tidy: 0 };
    for (const f of findings.value) if (!ignored.value.has(f.key)) out[f.severity] += 1;
    return out;
  });

  /** What the sidebar badge shows: problems and warnings, not clutter. */
  const badge = computed(() => counts.value.problem + counts.value.warning);

  async function runOnce(): Promise<void> {
    loading.value = true;
    try {
      const facts = await askCanvasFacts();
      const res = await api.health.scan(facts ? {
        ids: facts.ids,
        vars: facts.vars.map((v) => v.name),
        reads: facts.reads,
      } : null);
      scan.value = res;
      ignored.value = new Set(res.ignored);
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Scan now. A call while one runs queues one more run after it. */
  function refresh(): Promise<void> {
    if (pending) {
      again = true;
      return pending;
    }
    pending = (async () => {
      do {
        again = false;
        await runOnce();
      } while (again);
    })().finally(() => { pending = null; });
    return pending;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRefresh(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, RESCAN_MS);
  }

  /** Start once: first scan plus the library-change watcher. True when
   *  this call started it (a scan is then already running). */
  function ensure(): boolean {
    if (started) return false;
    started = true;
    void refresh();
    const signature = () => [
      libraryVersion.value,
      ...[moduleStore.catalog, bundleStore.catalog, templateStore.catalog]
        .map((rows) => rows.map((r) => `${r.id}@${r.updated_at}`).join(",")),
      categoryStore.items.map((c) => c.id).join(","),
    ].join("|");
    watch(signature, scheduleRefresh);
    return true;
  }

  async function setIgnored(add: string[], remove: string[] = []): Promise<void> {
    const res = await api.health.ignore(add, remove);
    ignored.value = new Set(res.ignored);
  }

  return {
    scan, loading, error, ignored, findings, checks, counts, badge,
    ensure, refresh, setIgnored,
  };
});
