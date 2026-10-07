import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** User-selected theme mode. `"auto"` follows the OS `prefers-color-scheme`. */
export type ThemeMode = "dark" | "light" | "auto";

/** Spacing/height density mode. `"comfortable"` is the default (multiplier 1).
 *  One setting for the whole manager: it used to be split between a
 *  compact/comfortable toggle here and a three-way control in the Tweaks panel
 *  that only changed control heights, so the two could disagree. */
export type DensityMode = "compact" | "comfortable" | "cozy";

/** Where the manager opens. `"last"` reopens the last page visited. */
export type StartPage = "dashboard" | "last" | "all" | "wildcards" | "test";

/** Manager animations. `"auto"` follows the OS `prefers-reduced-motion`;
 *  `"reduce"` turns them off on this device whatever the OS says. */
export type MotionMode = "auto" | "reduce";

/** Test Runner seed default for a new scenario. */
export interface TestRunnerDefaults {
  mode: "range" | "random";
  from: number;
  count: number;
}

/** When the wildcard editor's sub-category panel opens on load.
 *  `"populated"` (default) expands it only when the wildcard already has groups;
 *  `"always"` expands it even when empty; `"never"` keeps it collapsed. */
export type SubcatDefault = "populated" | "always" | "never";

const STORAGE_KEY = "wp-theme-mode";
const STORAGE_KEY_DENSITY = "wp-density-mode";
const STORAGE_KEY_MAX_REF_DEPTH = "wp-wildcard-max-ref-depth";
const STORAGE_KEY_CHECK_ON_LAUNCH = "wp-update-check-on-launch";
const STORAGE_KEY_KEEP_EMPTY_GROUPS = "wp-keep-empty-tag-groups";
const STORAGE_KEY_SUBCAT_DEFAULT = "wp-subcat-default";
const STORAGE_KEY_SIDEBAR_COLLAPSED = "wp-sidebar-collapsed";
const STORAGE_KEY_START_PAGE = "wp-start-page";
export const STORAGE_KEY_LAST_ROUTE = "wp-last-route";
const STORAGE_KEY_MOTION = "wp-motion";
const STORAGE_KEY_WHATS_NEW = "wp-whats-new-after-update";
/** Anonymous usage pings from the Community tab (passed to the embed). */
const STORAGE_KEY_USAGE_STATS = "wp-usage-stats";
export const STORAGE_KEY_LAST_SEEN_VERSION = "wp-last-seen-version";
export const STORAGE_KEY_TEST_RUNNER_DEFAULTS = "wp-test-runner-defaults";
/** Pre-merge home of density and the sidebar state (Tweaks panel). Read once
 *  as a fallback so nobody's choice resets when the settings moved. */
const LEGACY_TWEAKS_KEY = "wp-tweaks-v1";
import { notifyCompletionSettingsChanged } from "../utils/tagSetting";

const STORAGE_KEY_TAG_AUTOCOMPLETE = "wp-tag-autocomplete";
/* The other completion sources and the separator preference. Spellings are
 * shared with `manager/utils/tagSetting.ts`, which READS them on the editor's
 * hot path without going through Pinia — the canvas has no Pinia at all. This
 * store is the writer; that module is the reader. */
const STORAGE_KEY_LORA_AUTOCOMPLETE = "wp-lora-autocomplete";
const STORAGE_KEY_EMBEDDING_AUTOCOMPLETE = "wp-embedding-autocomplete";
const STORAGE_KEY_AUTOCOMPLETE_SEPARATOR = "wp-autocomplete-separator";

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
const FLASH_SUPPRESS_MS = 120;
const DEFAULT_MAX_REF_DEPTH = 8;
const MIN_MAX_REF_DEPTH = 1;
const MAX_MAX_REF_DEPTH = 32;

function readStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "auto") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "dark";
}

function readLegacyTweaks(): { density?: unknown; sidebarMode?: unknown } {
  try {
    const raw = localStorage.getItem(LEGACY_TWEAKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed as { density?: unknown; sidebarMode?: unknown } : {};
  } catch {
    return {};
  }
}

function isDensity(v: unknown): v is DensityMode {
  return v === "compact" || v === "comfortable" || v === "cozy";
}

function readStoredDensity(): DensityMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY_DENSITY);
    if (isDensity(v)) return v;
  } catch {
    /* localStorage unavailable */
  }
  const legacy = readLegacyTweaks().density;
  return isDensity(legacy) ? legacy : "comfortable";
}

function readStoredSidebarCollapsed(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_SIDEBAR_COLLAPSED);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* localStorage unavailable */
  }
  return readLegacyTweaks().sidebarMode === "collapsed";
}

function readStoredEnum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* localStorage unavailable */
  }
  return fallback;
}

export const START_PAGES: readonly StartPage[] = ["dashboard", "last", "all", "wildcards", "test"];
const MOTION_MODES: readonly MotionMode[] = ["auto", "reduce"];

export const DEFAULT_TEST_RUNNER: TestRunnerDefaults = { mode: "range", from: 0, count: 100 };
export const MAX_TEST_RUNNER_SEEDS = 10_000;

/** Clamp anything that looks like Test Runner defaults into a valid shape. */
export function normalizeTestRunnerDefaults(raw: unknown): TestRunnerDefaults {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fb);
  return {
    mode: o.mode === "random" ? "random" : "range",
    from: Math.max(0, num(o.from, DEFAULT_TEST_RUNNER.from)),
    count: Math.min(MAX_TEST_RUNNER_SEEDS, Math.max(1, num(o.count, DEFAULT_TEST_RUNNER.count))),
  };
}

/** Test Runner defaults as stored — read directly so the workbench composable
 *  does not need the store (it also runs in tests without Pinia). */
export function readTestRunnerDefaults(): TestRunnerDefaults {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEST_RUNNER_DEFAULTS);
    return normalizeTestRunnerDefaults(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_TEST_RUNNER };
  }
}

/** Control heights per density (the values the Tweaks panel always set). */
const DENSITY_CONTROL_H: Record<DensityMode, string> = {
  compact: "32px",
  comfortable: "38px",
  cozy: "44px",
};

/**
 * Whether an axis with no tags in it survives a save.
 *
 * A "+ Group" box the user created and had not filled yet was dropped on
 * save, which reads as the editor deleting their work — they had made the
 * group deliberately and intended to fill it later. Dropping is still the
 * default, because it is also what clears up boxes made by accident, but the
 * choice is now theirs.
 *
 * A preference rather than payload state: an empty axis is already
 * representable as `{axis: []}`, which the engine's validator accepts, so
 * keeping one needs no new field and no schema bump. The DECISION is what
 * varies per user; the RESULT is recorded in the payload like any other edit.
 */
/** Off unless explicitly enabled. The feature needs a tag list the user has
 *  to fetch first, so defaulting it on would advertise a capability that is
 *  not there yet. */
function readStoredTagAutocomplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_TAG_AUTOCOMPLETE) === "1";
  } catch {
    /* localStorage unavailable */
  }
  return false;
}

function readStoredKeepEmptyGroups(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_KEEP_EMPTY_GROUPS) === "1";
  } catch {
    /* localStorage unavailable */
  }
  return false;
}

function readStoredSubcatDefault(): SubcatDefault {
  try {
    const v = localStorage.getItem(STORAGE_KEY_SUBCAT_DEFAULT);
    if (v === "populated" || v === "always" || v === "never") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "populated";
}

function readStoredMaxRefDepth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY_MAX_REF_DEPTH);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= MIN_MAX_REF_DEPTH && n <= MAX_MAX_REF_DEPTH) {
        return n;
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_MAX_REF_DEPTH;
}

function readStoredCheckOnLaunch(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY_CHECK_ON_LAUNCH);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* localStorage unavailable */
  }
  return true; // default: check on launch
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export const useUiStore = defineStore("ui", () => {
  const themeMode = ref<ThemeMode>(readStoredTheme());
  const density = ref<DensityMode>(readStoredDensity());
  const sidebarCollapsed = ref(readStoredSidebarCollapsed());
  const startPage = ref<StartPage>(readStoredEnum(STORAGE_KEY_START_PAGE, START_PAGES, "dashboard"));
  const motion = ref<MotionMode>(readStoredEnum(STORAGE_KEY_MOTION, MOTION_MODES, "auto"));
  const whatsNewAfterUpdate = ref<boolean>(readStoredEnum(STORAGE_KEY_WHATS_NEW, ["1", "0"] as const, "1") === "1");
  const usageStats = ref<boolean>(readStoredEnum(STORAGE_KEY_USAGE_STATS, ["1", "0"] as const, "1") === "1");
  const testRunnerDefaults = ref<TestRunnerDefaults>(readTestRunnerDefaults());
  const maxRefDepth = ref<number>(readStoredMaxRefDepth());
  const checkOnLaunch = ref<boolean>(readStoredCheckOnLaunch());
  const keepEmptyTagGroups = ref<boolean>(readStoredKeepEmptyGroups());
  const subcatDefault = ref<SubcatDefault>(readStoredSubcatDefault());
  const tagAutocomplete = ref<boolean>(readStoredTagAutocomplete());
  const loraAutocomplete = ref<boolean>(readStoredFlag(STORAGE_KEY_LORA_AUTOCOMPLETE));
  const embeddingAutocomplete = ref<boolean>(readStoredFlag(STORAGE_KEY_EMBEDDING_AUTOCOMPLETE));
  const autocompleteSeparator = ref<boolean>(readStoredFlag(STORAGE_KEY_AUTOCOMPLETE_SEPARATOR));

  /** One writer for the three flags that share a shape. */
  function writeFlag(target: { value: boolean }, key: string, v: boolean): void {
    target.value = v;
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* localStorage unavailable */
    }
    // Editors read localStorage directly on their hot path rather than through
    // this store, so they need telling that it moved.
    notifyCompletionSettingsChanged();
  }

  function setLoraAutocomplete(v: boolean): void {
    writeFlag(loraAutocomplete, STORAGE_KEY_LORA_AUTOCOMPLETE, v);
  }
  function setEmbeddingAutocomplete(v: boolean): void {
    writeFlag(embeddingAutocomplete, STORAGE_KEY_EMBEDDING_AUTOCOMPLETE, v);
  }
  function setAutocompleteSeparator(v: boolean): void {
    writeFlag(autocompleteSeparator, STORAGE_KEY_AUTOCOMPLETE_SEPARATOR, v);
  }

  function setTagAutocomplete(v: boolean): void {
    tagAutocomplete.value = v;
    try {
      localStorage.setItem(STORAGE_KEY_TAG_AUTOCOMPLETE, v ? "1" : "0");
    } catch {
      /* localStorage unavailable */
    }
  }

  function setKeepEmptyTagGroups(v: boolean): void {
    keepEmptyTagGroups.value = v;
    try {
      localStorage.setItem(STORAGE_KEY_KEEP_EMPTY_GROUPS, v ? "1" : "0");
    } catch {
      /* localStorage unavailable */
    }
  }

  function setSubcatDefault(v: SubcatDefault): void {
    subcatDefault.value = v;
    try {
      localStorage.setItem(STORAGE_KEY_SUBCAT_DEFAULT, v);
    } catch {
      /* localStorage unavailable */
    }
  }

  /** Resolved theme — `"auto"` collapsed to dark/light via OS preference. */
  const resolvedTheme = computed<"dark" | "light">(() =>
    themeMode.value === "auto"
      ? (systemPrefersDark() ? "dark" : "light")
      : themeMode.value,
  );

  function applyThemeToDocument(mode: "dark" | "light") {
    const html = document.documentElement;
    // Briefly suppress transitions so the swap paints in one frame.
    html.classList.add("wp-theme-switching");
    html.classList.toggle("wp-dark", mode === "dark");
    html.classList.toggle("wp-theme-light", mode === "light");
    window.setTimeout(() => html.classList.remove("wp-theme-switching"), FLASH_SUPPRESS_MS);
  }

  function setThemeMode(mode: ThemeMode) {
    themeMode.value = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }

  function applyDensityToDocument(mode: DensityMode): void {
    const html = document.documentElement;
    html.classList.toggle("wp-density-compact", mode === "compact");
    html.classList.toggle("wp-density-cozy", mode === "cozy");
    const h = DENSITY_CONTROL_H[mode];
    html.style.setProperty("--wp-input-h", h);
    html.style.setProperty("--wp-btn-h", h);
  }

  function applyMotionToDocument(mode: MotionMode): void {
    const html = document.documentElement;
    html.classList.toggle("wp-reduce-motion", mode === "reduce");
  }

  function setMotion(mode: MotionMode): void {
    motion.value = mode;
    try { localStorage.setItem(STORAGE_KEY_MOTION, mode); } catch { /* ignore */ }
    applyMotionToDocument(mode);
  }

  function setStartPage(page: StartPage): void {
    startPage.value = page;
    try { localStorage.setItem(STORAGE_KEY_START_PAGE, page); } catch { /* ignore */ }
  }

  function setWhatsNewAfterUpdate(v: boolean): void {
    whatsNewAfterUpdate.value = v;
    try { localStorage.setItem(STORAGE_KEY_WHATS_NEW, v ? "1" : "0"); } catch { /* ignore */ }
  }

  function setUsageStats(v: boolean): void {
    usageStats.value = v;
    try { localStorage.setItem(STORAGE_KEY_USAGE_STATS, v ? "1" : "0"); } catch { /* ignore */ }
  }

  function setTestRunnerDefaults(patch: Partial<TestRunnerDefaults>): void {
    const next = normalizeTestRunnerDefaults({ ...testRunnerDefaults.value, ...patch });
    testRunnerDefaults.value = next;
    try { localStorage.setItem(STORAGE_KEY_TEST_RUNNER_DEFAULTS, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function setDensity(mode: DensityMode): void {
    density.value = mode;
    try { localStorage.setItem(STORAGE_KEY_DENSITY, mode); } catch { /* ignore */ }
    applyDensityToDocument(mode);
  }

  function toggleDensity(): void {
    setDensity(density.value === "compact" ? "comfortable" : "compact");
  }

  /** Local mirror of the server-side limit (`useServerSettings` owns the
   *  real value, which runs read). Not persisted here any more: the old
   *  localStorage copy was read by nothing, and is migrated to the server
   *  once. */
  function setMaxRefDepth(depth: number) {
    maxRefDepth.value = Math.max(MIN_MAX_REF_DEPTH, Math.min(MAX_MAX_REF_DEPTH, Math.floor(depth)));
  }

  /** Cycle dark → light → auto → dark. */
  function cycleTheme() {
    const next: ThemeMode =
      themeMode.value === "dark" ? "light"
      : themeMode.value === "light" ? "auto"
      : "dark";
    setThemeMode(next);
  }

  function initializeTheme() {
    applyThemeToDocument(resolvedTheme.value);
    applyDensityToDocument(density.value);
    applyMotionToDocument(motion.value);
    // React to OS theme changes when in auto mode.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (themeMode.value === "auto") applyThemeToDocument(resolvedTheme.value);
      };
      mq.addEventListener("change", onChange);
    }
    watch(resolvedTheme, (m) => applyThemeToDocument(m));
  }

  function setSidebarCollapsed(v: boolean): void {
    sidebarCollapsed.value = v;
    try { localStorage.setItem(STORAGE_KEY_SIDEBAR_COLLAPSED, v ? "1" : "0"); } catch { /* ignore */ }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed.value);
  }

  function setCheckOnLaunch(v: boolean): void {
    checkOnLaunch.value = v;
    try { localStorage.setItem(STORAGE_KEY_CHECK_ON_LAUNCH, String(v)); } catch { /* ignore */ }
  }

  return {
    themeMode,
    resolvedTheme,
    density,
    sidebarCollapsed,
    setSidebarCollapsed,
    startPage,
    setStartPage,
    motion,
    setMotion,
    whatsNewAfterUpdate,
    setWhatsNewAfterUpdate,
    usageStats,
    setUsageStats,
    testRunnerDefaults,
    setTestRunnerDefaults,
    maxRefDepth,
    checkOnLaunch,
    keepEmptyTagGroups,
    setKeepEmptyTagGroups,
    subcatDefault,
    setSubcatDefault,
    tagAutocomplete,
    setTagAutocomplete,
    loraAutocomplete,
    setLoraAutocomplete,
    embeddingAutocomplete,
    setEmbeddingAutocomplete,
    autocompleteSeparator,
    setAutocompleteSeparator,
    cycleTheme,
    setThemeMode,
    setDensity,
    toggleDensity,
    setMaxRefDepth,
    setCheckOnLaunch,
    initializeTheme,
    toggleSidebar,
  };
});
