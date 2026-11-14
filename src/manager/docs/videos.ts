/**
 * The video tutorials on YouTube: one playlist per section and one video per
 * tutorial (`tutorials/tests/`). The docs pages show the videos about them
 * under their title (`PAGE_VIDEOS`), the Video tutorials page lists them all,
 * and `docs/help/WP_*.md` link each node's video (`pnpm docs:help`).
 *
 * The ids come from `youtube-links.json`, which the upload script writes next
 * to the videos. A retake is a new upload with a new id; the playlist ids
 * never change.
 */

import type { InjectionKey, Ref } from "vue";

/** The open docs page's id, provided by Docs.vue so DocPage can show its videos. */
export const DOC_PAGE_ID: InjectionKey<Readonly<Ref<string | undefined>>> = Symbol("wp-doc-page-id");

export type VideoSectionId = "start" | "advanced" | "library" | "nodes" | "examples" | "ai";

export interface VideoSection {
  id: VideoSectionId;
  title: string;
  blurb: string;
  icon: string;
  /** YouTube playlist id. */
  playlist: string;
}

export interface TutorialVideo {
  /** The tutorial's code ("T03", "N12"), as in `tutorials/tests/`. */
  code: string;
  title: string;
  section: VideoSectionId;
  /** YouTube video id. */
  id: string;
}

export const VIDEO_SECTIONS: VideoSection[] = [
  { id: "start", title: "Get started", icon: "pi pi-play", playlist: "PLL3gpkYlX_Lk",
    blurb: "From a first look around to bundles, themes and autocomplete. Start here." },
  { id: "advanced", title: "Advanced", icon: "pi pi-sliders-h", playlist: "PLDrl0ZXngWsY",
    blurb: "Tag groups, multi-picks, rules and constraints in depth, negatives, loops, switches and subgraphs." },
  { id: "library", title: "Library", icon: "pi pi-book", playlist: "PLGQhUveOpjMs",
    blurb: "The Test Runner, library health, importing packs, sharing, backups and keeping a big library tidy." },
  { id: "nodes", title: "Nodes", icon: "pi pi-sitemap", playlist: "PLD9orcFSB7nI",
    blurb: "One video per node: every field, its inputs and outputs, recipes and gotchas." },
  { id: "examples", title: "Examples", icon: "pi pi-th-large", playlist: "PLPLr4xEq-3TA",
    blurb: "The example workflows, built and run step by step." },
  { id: "ai", title: "AI assistant", icon: "pi pi-microchip-ai", playlist: "PLTkbhMOBM8zs",
    blurb: "Set up a model, chat, draft with AI, build packs, search the web and look up tags." },
];

export const TUTORIAL_VIDEOS: TutorialVideo[] = [
  { code: "T00", section: "start", id: "FBoHlu7qoE0", title: "A first look around" },
  { code: "T01", section: "start", id: "7nJoBzSeW7E", title: "Before you start: the tutorial library" },
  { code: "T02", section: "start", id: "069JolQ1drg", title: "Your first random prompt" },
  { code: "T03", section: "start", id: "dM4bFt6Ov3A", title: "Make your own wildcard" },
  { code: "T04", section: "start", id: "KptgdKooRQ8", title: "Fixed values and combines" },
  { code: "T05", section: "start", id: "3ZC1ZDvkmKc", title: "Derivations: rules that set a variable" },
  { code: "T06", section: "start", id: "aNg8mb5Ok1E", title: "Constraints: keep clashing picks apart" },
  { code: "T07", section: "start", id: "rn9-sclZr3s", title: "Templates: save a prompt and reuse it" },
  { code: "T08", section: "start", id: "QocIm8X8Apo", title: "Bundles: a whole set in one click" },
  { code: "T09", section: "start", id: "QKS46LXIZMo", title: "Working in the Context node" },
  { code: "T10", section: "start", id: "HgRT7FR8Km4", title: "Make it look your way: themes and display" },
  { code: "T11", section: "start", id: "L__0ZddMxNc", title: "Autocomplete in every text box" },
  { code: "T12", section: "start", id: "6Ym6nt1VHRY", title: "Where to find help" },
  { code: "A01", section: "advanced", id: "uxThNP2udLw", title: "Tag groups: describe an option or roll one of its tags" },
  { code: "A02", section: "advanced", id: "pqlAQtmNAzA", title: "Pick several at once" },
  { code: "A03", section: "advanced", id: "KhhK7aYWo6M", title: "Wildcards inside wildcards" },
  { code: "A03b", section: "advanced", id: "dy5Y6v2Xe7A", title: "The pool and the Advanced switch" },
  { code: "A04", section: "advanced", id: "ZHqxEri6Zpk", title: "Reading a pick's parts" },
  { code: "A05", section: "advanced", id: "lPnCgDZy5Vg", title: "Hold and match" },
  { code: "A06", section: "advanced", id: "xx5H4zyV55c", title: "When nothing fits: empty options and fallbacks" },
  { code: "A07", section: "advanced", id: "HiwjClQetFg", title: "Derivations in depth" },
  { code: "A08", section: "advanced", id: "GS7Q-KM3TPk", title: "The constraint matrix in depth" },
  { code: "A09", section: "advanced", id: "Mb0Me8arcf8", title: "How far a constraint reaches" },
  { code: "A10", section: "advanced", id: "b2sBf5YMxHE", title: "Negatives: send words to the negative prompt" },
  { code: "A11", section: "advanced", id: "ojlLMRHIAek", title: "Chaining Contexts" },
  { code: "A12", section: "advanced", id: "onJll2YVxD8", title: "The Context Injector" },
  { code: "A13", section: "advanced", id: "TzUQtTpBiAs", title: "LoRA trigger words" },
  { code: "A14", section: "advanced", id: "9ewWOoCV7Bo", title: "Var nodes: rules that set numbers and settings" },
  { code: "A15", section: "advanced", id: "KrXO55kERcc", title: "Model-aware prompts" },
  { code: "A16", section: "advanced", id: "i8ycPEmVZyo", title: "Loops and seeds: many images in one run" },
  { code: "A17", section: "advanced", id: "wHQp0aPncWM", title: "Switches: turn parts of a prompt on and off" },
  { code: "A18", section: "advanced", id: "9wzKSGvA1-I", title: "Subgraphs: Wildcard Pipeline inside a subgraph" },
  { code: "A19", section: "advanced", id: "QsWGfTOt_b4", title: "Warnings on the canvas" },
  { code: "L01", section: "library", id: "KSOzNEyjZg0", title: "The Test Runner: see what your library rolls" },
  { code: "L02", section: "library", id: "zTdZq61W9Jc", title: "Library health: find problems early" },
  { code: "L03", section: "library", id: "uQ52U7oNayw", title: "Import wildcard packs from text files" },
  { code: "L04", section: "library", id: "W-SrI4vVmlA", title: "Share and publish your packs" },
  { code: "L05", section: "library", id: "RkVHXSROoAY", title: "Backups: never lose your library" },
  { code: "L06", section: "library", id: "ifaYIWVLyHw", title: "Keep a big library tidy" },
  { code: "N01", section: "nodes", id: "wkuk_8ytG5s", title: "WP Context in depth" },
  { code: "N02", section: "nodes", id: "Zq7pY42f_qI", title: "WP Prompt Assembler in depth" },
  { code: "N03", section: "nodes", id: "iwPrjMEK6kg", title: "WP Debug in depth" },
  { code: "N04", section: "nodes", id: "5pnV2ExnfQk", title: "WP Context Injector in depth" },
  { code: "N05", section: "nodes", id: "Oq86nN1CH1c", title: "WP Context Loop in depth" },
  { code: "N06", section: "nodes", id: "Se5_0BDex9A", title: "WP Seed List in depth" },
  { code: "N07", section: "nodes", id: "LSRj9uxAOTA", title: "WP Toggles in depth" },
  { code: "N08", section: "nodes", id: "rWgYvOhoT0c", title: "WP Node Group in depth: switch many nodes at once" },
  { code: "N09", section: "nodes", id: "QWK6l4IMCD4", title: "WP Model Info in depth" },
  { code: "N10", section: "nodes", id: "4HQJLkxikkg", title: "WP Var to Int in depth" },
  { code: "N11", section: "nodes", id: "pxq0d4rCO8c", title: "WP Prompt Cleaner in depth" },
  { code: "N12", section: "nodes", id: "tcs5D7BiGTI", title: "WP Image Filter in depth: pick, paint and refine" },
  { code: "N13", section: "nodes", id: "T_-Dbi0qqD0", title: "WP Label & Grid in depth: XY plots and contact sheets" },
  { code: "N14", section: "nodes", id: "9ljZ5XU7o7A", title: "WP Note in depth" },
  { code: "N15", section: "nodes", id: "jxBY9jJYLYc", title: "WP Bookmark in depth" },
  { code: "N16", section: "nodes", id: "LYNoJcENR1k", title: "WP Mode Relay in depth" },
  { code: "N17", section: "nodes", id: "VH7Ssu56szE", title: "WP Var to Float in depth" },
  { code: "N18", section: "nodes", id: "wOF72EMrCz8", title: "WP Var to Choice in depth" },
  { code: "N19", section: "nodes", id: "vVwMWvdM44I", title: "WP Var to Bool in depth" },
  { code: "E1", section: "examples", id: "Z8aa-widlko", title: "Example workflow: One image" },
  { code: "E2", section: "examples", id: "tP9FeBhNcHE", title: "Example workflow: Batches and grids" },
  { code: "E3", section: "examples", id: "G7pN707n7hw", title: "Example workflow: Pick and refine" },
  { code: "E4", section: "examples", id: "BOc7fpIsdg0", title: "Example workflow: Sets and stories" },
  { code: "AI1", section: "ai", id: "h9JCiKTc3EE", title: "AI assistant: set up and chat" },
  { code: "AI2", section: "ai", id: "nNlf39zva20", title: "AI assistant: draft with AI" },
  { code: "AI3", section: "ai", id: "ToEjxJiwBLA", title: "AI assistant: the pack builder" },
  { code: "AI4", section: "ai", id: "NyYJbzbwPdo", title: "AI assistant: web search and tag lookup" },
];

/**
 * The videos about each docs page, by page id, in the order to watch them.
 * A page with none shows no video row; the Video tutorials page lists all.
 */
export const PAGE_VIDEOS: Record<string, string[]> = {
  "introduction": ["T00"],
  "quick-start": ["T01", "T02"],
  "test-runner": ["L01"],
  "library-health": ["L02", "L06"],
  "themes": ["T10"],
  "howto-examples": ["E1", "E2", "E3", "E4"],
  "howto-variations": ["A16", "E2"],
  "howto-picks-agree": ["T06", "A05"],
  "howto-keep-steady": ["A05", "A16"],
  "howto-share": ["L04", "L05"],
  "troubleshooting": ["T12", "A19"],
  "ai-assistant": ["AI1"],
  "ai-setup": ["AI1"],
  "ai-drafts": ["AI2"],
  "ai-chat": ["AI1"],
  "ai-pack-builder": ["AI3"],
  "ai-web": ["AI4"],
  "prompt-writing": ["A13", "A15"],
  "chips-and-references": ["A03", "T11"],
  "context-chaining": ["A11", "A18"],
  "seeds-and-loops": ["A16"],
  "iteration-overrides": ["N05"],
  "constraints": ["A08", "A09"],
  "negatives": ["A10"],
  "conflicts-and-warnings": ["A19"],
  "wp-context": ["N01", "T09"],
  "wp-context-loop": ["N05", "A16"],
  "wp-seed-list": ["N06"],
  "wp-context-injector": ["N04", "A12"],
  "wp-model-info": ["N09", "A15"],
  "wp-toggles": ["N07", "A17"],
  "wp-node-group": ["N08"],
  "wp-mode-relay": ["N16"],
  "wp-bookmark": ["N15"],
  "wp-prompt-assembler": ["N02"],
  "wp-prompt-cleaner": ["N11"],
  "wp-image-filter": ["N12"],
  "wp-label-grid": ["N13"],
  "wp-debug": ["N03"],
  "wp-var-to-int": ["N10", "A14"],
  "wp-var-to-float": ["N17", "A14"],
  "wp-var-to-bool": ["N19", "A14"],
  "wp-var-to-choice": ["N18", "A14"],
  "wp-note": ["N14"],
  "wildcard": ["T03", "A01", "A02", "A03", "A03b", "A04", "A06"],
  "wildcard-import": ["L03"],
  "fixed-values": ["T04"],
  "combine": ["T04"],
  "derivation": ["T05", "A07"],
  "constraint": ["T06", "A08", "A09"],
  "bundles": ["T08"],
  "templates": ["T07"],
};

/** Each node's own in-depth video, by node id (the node help pages link it). */
export const NODE_VIDEOS: Record<string, string> = {
  WP_Context: "N01",
  WP_PromptAssembler: "N02",
  WP_Debug: "N03",
  WP_ContextInjector: "N04",
  WP_ContextLoop: "N05",
  WP_SeedList: "N06",
  WP_Toggles: "N07",
  WP_NodeGroup: "N08",
  WP_ModelInfo: "N09",
  WP_VarToInt: "N10",
  WP_PromptCleaner: "N11",
  WP_ImageFilter: "N12",
  WP_LabelGrid: "N13",
  WP_Note: "N14",
  WP_Bookmark: "N15",
  WP_ModeRelay: "N16",
  WP_VarToFloat: "N17",
  WP_VarToChoice: "N18",
  WP_VarToBool: "N19",
};

export function videoUrl(v: TutorialVideo): string {
  return `https://youtu.be/${v.id}`;
}

export function playlistUrl(s: VideoSection): string {
  return `https://www.youtube.com/playlist?list=${s.playlist}`;
}

export function findVideo(code: string): TutorialVideo | undefined {
  return TUTORIAL_VIDEOS.find((v) => v.code === code);
}

export function findSection(id: VideoSectionId): VideoSection | undefined {
  return VIDEO_SECTIONS.find((s) => s.id === id);
}

export function videosIn(section: VideoSectionId): TutorialVideo[] {
  return TUTORIAL_VIDEOS.filter((v) => v.section === section);
}

/** The videos about a docs page (none for a page without any). */
export function pageVideos(pageId: string | undefined): TutorialVideo[] {
  if (!pageId) return [];
  return (PAGE_VIDEOS[pageId] ?? []).map(findVideo).filter((v): v is TutorialVideo => !!v);
}
