/**
 * The Settings page's sections and a flat, searchable list of every setting.
 *
 * Search matches `label`, `hint` and `keywords`; a hit links to
 * `/settings/<section>#<key>`, where the row with that `settingKey` scrolls
 * into view and flashes. Keep an entry here for every SettingRow so search
 * can find it (`settings-index.test.ts` checks each section's rows are listed).
 */
import { CANVAS_SETTINGS } from "../../../extension/settings-catalog";

export type SectionId =
  | "general" | "appearance" | "editing" | "autocomplete"
  | "canvas" | "test-runner" | "library" | "advanced";

export interface SectionDef { id: SectionId; label: string; icon: string; blurb: string }

export const SECTIONS: SectionDef[] = [
  { id: "general", label: "General", icon: "pi-info-circle", blurb: "Version, updates, what's new and privacy." },
  { id: "appearance", label: "Appearance", icon: "pi-palette", blurb: "How the manager looks on this device." },
  { id: "editing", label: "Editing", icon: "pi-pencil", blurb: "How the module editors behave." },
  { id: "autocomplete", label: "Autocomplete", icon: "pi-bolt", blurb: "Suggestions while you type option values." },
  { id: "canvas", label: "Canvas", icon: "pi-sitemap", blurb: "The nodes on the ComfyUI canvas, and how runs resolve." },
  { id: "test-runner", label: "Test Runner", icon: "pi-play", blurb: "What a new Test Runner scenario starts with." },
  { id: "library", label: "Library & data", icon: "pi-database", blurb: "Your module database, backups and maintenance." },
  { id: "advanced", label: "Advanced", icon: "pi-cog", blurb: "Move settings between machines, or start over." },
];

export interface SettingEntry {
  key: string;
  section: SectionId;
  label: string;
  hint: string;
  keywords?: string;
}

const STATIC_ENTRIES: SettingEntry[] = [
  { key: "about", section: "general", label: "About", hint: "Version, license and source repository.", keywords: "version license github" },
  { key: "check-on-launch", section: "general", label: "Check for updates on launch", hint: "Look for a newer release when the manager opens.", keywords: "update release" },
  { key: "check-now", section: "general", label: "Check for updates now", hint: "Ask GitHub for the latest release.", keywords: "update release" },
  { key: "whats-new", section: "general", label: "Open What's new after an update", hint: "Show the release notes once, the first time the manager opens on a new version.", keywords: "changelog release notes" },
  { key: "usage-stats", section: "general", label: "Share anonymous usage stats", hint: "Let the Community tab count page views, installs and publishes on the community site.", keywords: "privacy telemetry analytics tracking community" },

  { key: "theme", section: "appearance", label: "Theme", hint: "Dark, light, or follow the system.", keywords: "dark light mode color scheme" },
  { key: "accent", section: "appearance", label: "Accent color", hint: "The highlight color used for buttons, links and selection.", keywords: "colour palette purple custom hex" },
  { key: "density", section: "appearance", label: "Density", hint: "Spacing and control height across the manager.", keywords: "compact cozy comfortable spacing size" },
  { key: "sidebar", section: "appearance", label: "Sidebar", hint: "Show the navigation with labels, or as icons only.", keywords: "collapse navigation" },
  { key: "start-page", section: "appearance", label: "Start page", hint: "What the manager opens to.", keywords: "home dashboard landing last page" },
  { key: "motion", section: "appearance", label: "Reduce motion", hint: "Turn animations and transitions off in the manager.", keywords: "animation accessibility a11y" },

  { key: "keep-empty-groups", section: "editing", label: "Keep empty tag groups", hint: "Keep a tag group with no tags when saving a wildcard.", keywords: "axis subcategory" },
  { key: "subcat-panel", section: "editing", label: "Sub-categories panel", hint: "Whether the sub-categories panel opens on its own in the wildcard editor.", keywords: "axes groups" },

  { key: "ac-tags", section: "autocomplete", label: "Booru tags", hint: "Danbooru tag names while you type option values.", keywords: "danbooru tag list csv download" },
  { key: "ac-lora", section: "autocomplete", label: "LoRAs", hint: "Installed LoRA names, inserted as <lora:name:1.0>.", keywords: "lora model" },
  { key: "ac-embedding", section: "autocomplete", label: "Embeddings", hint: "Installed embedding names.", keywords: "embedding textual inversion" },
  { key: "ac-separator", section: "autocomplete", label: "Append \", \" after a pick", hint: "Follow each completion with a comma and a space.", keywords: "comma separator" },
  { key: "ac-max", section: "autocomplete", label: "Max suggestions", hint: "How many tag suggestions the popup lists.", keywords: "limit rows popup" },
  { key: "ac-min", section: "autocomplete", label: "Minimum characters", hint: "Letters typed before tag suggestions appear.", keywords: "threshold popup" },

  { key: "ref-depth", section: "canvas", label: "Ref recursion limit", hint: "How deep nested @{uuid} references resolve when a workflow runs.", keywords: "nested reference depth recursion wildcard" },

  { key: "tr-mode", section: "test-runner", label: "Seed mode", hint: "Consecutive seeds, or a fresh random set on every run.", keywords: "seed random range" },
  { key: "tr-from", section: "test-runner", label: "First seed", hint: "Where a consecutive range starts.", keywords: "seed fixed start" },
  { key: "tr-count", section: "test-runner", label: "Number of seeds", hint: "How many prompts a run makes.", keywords: "samples count runs" },

  { key: "db-summary", section: "library", label: "Database", hint: "File, size and what is in it.", keywords: "sqlite file size rows" },
  { key: "backups-auto", section: "library", label: "Automatic backups", hint: "Copy the database before every migration and once a day.", keywords: "backup restore snapshot" },
  { key: "backups-keep", section: "library", label: "Backups to keep", hint: "Older automatic backups are deleted.", keywords: "backup retention" },
  { key: "backups-list", section: "library", label: "Backups", hint: "Back up now, restore, or delete a backup.", keywords: "backup restore" },
  { key: "db-location", section: "library", label: "Database location", hint: "Where the database file lives.", keywords: "path move copy user global root" },
  { key: "db-maintenance", section: "library", label: "Maintenance", hint: "Vacuum, integrity check, analyze, re-run migrations.", keywords: "vacuum integrity analyze migrations schema" },

  { key: "export-settings", section: "advanced", label: "Export settings", hint: "Save every preference to a JSON file.", keywords: "backup transfer json" },
  { key: "import-settings", section: "advanced", label: "Import settings", hint: "Load a settings file from another machine.", keywords: "restore transfer json" },
  { key: "reset-prefs", section: "advanced", label: "Reset browser preferences", hint: "Clear this device's preferences. Your library is untouched.", keywords: "reset clear localstorage" },
];

const CANVAS_ENTRIES: SettingEntry[] = CANVAS_SETTINGS.map((s) => ({
  key: `canvas-${s.id.split(".").pop() ?? s.id}`,
  section: "canvas" as const,
  label: s.name,
  hint: s.tooltip,
  keywords: "canvas node comfyui",
}));

export const SETTING_ENTRIES: SettingEntry[] = [...STATIC_ENTRIES, ...CANVAS_ENTRIES];

/** Row anchor for a canvas setting id. */
export function canvasKey(id: string): string {
  return `canvas-${id.split(".").pop() ?? id}`;
}

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === "string" && SECTIONS.some((s) => s.id === v);
}

/** Entries matching every word of `query`, best (label) matches first. */
export function searchSettings(query: string): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: Array<{ e: SettingEntry; score: number }> = [];
  for (const e of SETTING_ENTRIES) {
    const label = e.label.toLowerCase();
    const rest = `${e.hint} ${e.keywords ?? ""}`.toLowerCase();
    if (!words.every((w) => label.includes(w) || rest.includes(w))) continue;
    const score = words.filter((w) => label.includes(w)).length;
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.e);
}
