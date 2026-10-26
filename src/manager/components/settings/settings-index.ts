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
  | "canvas" | "test-runner" | "ai" | "library" | "advanced";

export interface SectionDef { id: SectionId; label: string; icon: string; blurb: string }

export const SECTIONS: SectionDef[] = [
  { id: "general", label: "General", icon: "pi-info-circle", blurb: "Version, updates, what's new and privacy." },
  { id: "appearance", label: "Appearance", icon: "pi-palette", blurb: "How the manager looks on this device." },
  { id: "editing", label: "Editing", icon: "pi-pencil", blurb: "How the module editors behave." },
  { id: "autocomplete", label: "Autocomplete", icon: "pi-bolt", blurb: "Suggestions while you type option values." },
  { id: "canvas", label: "Canvas", icon: "pi-sitemap", blurb: "The nodes on the ComfyUI canvas, and how runs resolve." },
  { id: "test-runner", label: "Test Runner", icon: "pi-play", blurb: "What a new Test Runner scenario starts with." },
  { id: "ai", label: "AI assistant", icon: "pi-microchip-ai", blurb: "Use your own model (Claude, OpenAI or a local server) to draft modules." },
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

  { key: "ai-enabled", section: "ai", label: "Turn on the AI assistant", hint: "Adds the AI tools (editor panels, Describe, Organize, the chat and the Pack builder), using a model you already have.", keywords: "llm claude openai ollama lm studio llama gpt assistant" },
  { key: "ai-provider", section: "ai", label: "Provider", hint: "Who runs the model.", keywords: "claude anthropic openai ollama lm studio llama.cpp local cloud" },
  { key: "ai-address", section: "ai", label: "Server address", hint: "Where the model server answers.", keywords: "url base endpoint host port" },
  { key: "ai-key", section: "ai", label: "API key", hint: "Saved on the ComfyUI machine and never shown again.", keywords: "token secret credential" },
  { key: "ai-model", section: "ai", label: "Model", hint: "Which model the assistant uses.", keywords: "llm qwen gemma claude gpt" },
  { key: "ai-model-size", section: "ai", label: "Model size", hint: "How much the assistant asks of the model: shorter instructions for small ones.", keywords: "small medium large parameters 12b 27b profile per model per provider saved" },
  { key: "ai-context", section: "ai", label: "Most context to use", hint: "The context the assistant asks Ollama for, in tokens. At least 16k; 32k for chats that take several steps.", keywords: "num_ctx context window tokens ollama memory vram" },
  { key: "ai-unload", section: "ai", label: "Unload the model after", hint: "Free the GPU for ComfyUI after a short idle.", keywords: "vram gpu keep alive ttl memory" },
  { key: "ai-thinking", section: "ai", label: "Thinking", hint: "Let a thinking model reason first, ask it to answer straight away, or pick how much it reasons. Shows only what the chosen model takes.", keywords: "reasoning think effort level on off low medium high xhigh extra max qwen deepseek r1 claude gpt openrouter lm studio cut off output limit slow per model per provider saved stuck" },
  { key: "ai-embed-key", section: "ai", label: "Embedding server key", hint: "A key for an embedding server other than the chat's, sent only there.", keywords: "embeddings api key token openai" },
  { key: "ai-choose-first", section: "ai", label: "Choose the tool first", hint: "Small and medium local models name the tool, then write only its arguments.", keywords: "tools small model json choose fill experiment advanced" },
  { key: "ai-lean-prompt", section: "ai", label: "Short tool list", hint: "Small local models get one line per tool; each tool's full description comes when a step first offers it.", keywords: "tools small model json lean prompt short context tokens advanced" },
  { key: "ai-debug-log", section: "ai", label: "Debug log", hint: "Record every AI request (prompt, reply, thinking, tool calls, tokens) and copy it from the top bar.", keywords: "debug log trace prompt reply raw request copy tokens troubleshoot bug" },
  { key: "ai-sampling", section: "ai", label: "Sampling", hint: "Optional top K, top P, min P, repeat and presence penalty sent with each request; empty uses the server's own setting.", keywords: "samplers sampling top_k top_p min_p repeat repetition presence penalty temperature qwen lm studio ollama llama.cpp openrouter advanced" },
  { key: "ai-reset", section: "ai", label: "Reset to recommended", hint: "Puts every AI choice back to its recommended value; keeps provider, keys and models.", keywords: "reset defaults recommended restore settings" },
  { key: "ai-tool-format", section: "ai", label: "Tool format", hint: "How the chat calls its tools: native tool calls or the JSON step format.", keywords: "tools function calling json native advanced" },
  { key: "ai-embed-model", section: "ai", label: "Embedding model", hint: "Meaning search: lets the chat find items by what they mean, not only their words. Off when empty.", keywords: "embeddings vector semantic meaning search nomic embeddinggemma rag retrieval" },
  { key: "ai-embed-api", section: "ai", label: "Embedding server type", hint: "Ollama or OpenAI-compatible, for an embedding server other than the chat's.", keywords: "embeddings api ollama openai lm studio voyage openrouter" },
  { key: "ai-embed-address", section: "ai", label: "Embedding server", hint: "Where the embedding model runs, when it isn't the chat's server. Its models are listed from there.", keywords: "embeddings url llama.cpp address openai ollama openrouter voyage lm studio auto-evict" },
  { key: "ai-index", section: "ai", label: "Library index", hint: "The chat's search index of your library. Rebuild it if search seems off.", keywords: "index fts search rebuild vectors retrieval" },
  { key: "ai-explain-chip", section: "ai", label: "Show Explain on selected text", hint: "A small Explain / Ask bar over text you select; Ctrl+Shift+X explains it without the bar.", keywords: "ai assistant chat selection highlight explain ask toolbar shortcut" },
  { key: "ai-chat-show-thinking", section: "ai", label: "Show thinking", hint: "Show or hide what a thinking model reasoned, in the chat.", keywords: "ai assistant chat thinking reasoning hide show" },
  { key: "ai-chat-show-notes", section: "ai", label: "Show working notes", hint: "Show or hide the text the model writes between steps.", keywords: "ai assistant chat working note hide show" },
  { key: "ai-chat-show-steps", section: "ai", label: "Show what it did", hint: "Show or hide the lines listing what the assistant read, searched and ran.", keywords: "ai assistant chat steps tools read docs search hide show only messages" },
  { key: "ai-chat-type-out", section: "ai", label: "Type out replies", hint: "Show the reply word by word as the model writes it, or all at once when it is done.", keywords: "ai assistant chat stream streaming typing live word by word at once" },
  { key: "ai-allow-delete", section: "ai", label: "Let the assistant delete items", hint: "Lets the chat propose deleting items, categories and tags. Each delete still needs your confirm, and Undo brings it back.", keywords: "ai assistant chat delete remove permission allow" },
  { key: "ai-auto-apply", section: "ai", label: "Apply small changes automatically", hint: "Descriptions, tags and categories from the chat apply without a click, with Undo.", keywords: "ai assistant chat auto apply automatic permission trust" },
  { key: "ai-search-engine", section: "ai", label: "Web search", hint: "Let the chat search the web with SearXNG, Brave, Tavily or Kagi. Every search asks you first.", keywords: "internet web search searxng brave tavily kagi lookup" },
  { key: "ai-search-url", section: "ai", label: "SearXNG address", hint: "Your SearXNG server, with JSON output turned on.", keywords: "searxng url address json" },
  { key: "ai-search-key", section: "ai", label: "Search engine key", hint: "The Brave, Tavily or Kagi key, sent only to that engine.", keywords: "api key brave tavily kagi token" },
  { key: "ai-reader", section: "ai", label: "Read result pages", hint: "Let the chat read one page its search returned, after you allow it: built in, or your Crawl4AI or Firecrawl server.", keywords: "read page fetch crawl4ai firecrawl scrape article url" },
  { key: "ai-reader-url", section: "ai", label: "Page reader address", hint: "Your Crawl4AI or Firecrawl server.", keywords: "crawl4ai firecrawl url address" },
  { key: "ai-reader-key", section: "ai", label: "Page reader key", hint: "The Firecrawl key or Crawl4AI token, sent only to that server.", keywords: "firecrawl crawl4ai api key token" },
  { key: "ai-danbooru", section: "ai", label: "Danbooru tag lookup", hint: "Let the chat look a tag up on Danbooru: wiki, aliases, implications and related tags. Each lookup asks first.", keywords: "danbooru tag wiki alias implication related booru" },
  { key: "ai-web-always", section: "ai", label: "Don't ask before web calls", hint: "Run web searches, page reads and Danbooru lookups without the Allow card.", keywords: "allow approve ask permission web search always" },
  { key: "ai-test", section: "ai", label: "Test connection", hint: "Check the server answers and the model returns JSON, and see how much context a chat takes before you type.", keywords: "check ping prefix tokens context" },
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
