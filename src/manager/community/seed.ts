/**
 * Seed data for the Community tab.
 *
 * UI-only mock — these entries simulate ~30 modules + a handful of bundles
 * spanning every kind. Authors, hero gradients, and counts are hand-tuned
 * so the screens look believable without a real registry backend.
 */
import type {
  CommunityAtom,
  CommunityBundle,
  CommunityComment,
  CommunityKind,
  CommunityModule,
  CommunityUser,
  CommunityVersion,
} from "./types";

const NOW = Date.now();
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const hr = (n: number) => new Date(NOW - n * 3_600_000).toISOString();

export const SEED_AUTHORS: CommunityUser[] = [
  { login: "anya-vox",    name: "Anya V.",       avatar_url: "https://avatars.githubusercontent.com/u/1?v=4", verified: true  },
  { login: "kaito.studio",name: "Kaito Studio",  avatar_url: "https://avatars.githubusercontent.com/u/2?v=4", verified: true  },
  { login: "marlow",      name: "Sam Marlow",    avatar_url: "https://avatars.githubusercontent.com/u/3?v=4", verified: false },
  { login: "mira.lab",    name: "Mira Lab",      avatar_url: "https://avatars.githubusercontent.com/u/4?v=4", verified: true  },
  { login: "pixelnaut",   name: "pixelnaut",     avatar_url: "https://avatars.githubusercontent.com/u/5?v=4", verified: false },
  { login: "penumbra-co", name: "Penumbra Co.",  avatar_url: "https://avatars.githubusercontent.com/u/6?v=4", verified: true  },
  { login: "lila",        name: "Lila Tran",     avatar_url: "https://avatars.githubusercontent.com/u/7?v=4", verified: false },
  { login: "dax-prompts", name: "Dax",           avatar_url: "https://avatars.githubusercontent.com/u/8?v=4", verified: true  },
];

const a = (login: string): CommunityUser =>
  SEED_AUTHORS.find((u) => u.login === login)!;

export const SEED_TAGS = [
  "portrait", "scene", "lighting", "cinematic", "studio",
  "nsfw", "anime", "photoreal", "concept-art", "fashion",
  "weather", "post-process", "negative", "fantasy", "sci-fi",
  "ghibli", "noir", "vibrant", "pastel", "monochrome",
];

/** Reasonable rating-distribution skew for a given mean — keeps math simple. */
function ratingDist(mean: number, total: number): number[] {
  const w =
    mean >= 4.5 ? [0.72, 0.21, 0.05, 0.015, 0.005] :
    mean >= 4.0 ? [0.55, 0.30, 0.10, 0.03, 0.02] :
                  [0.35, 0.32, 0.20, 0.08, 0.05];
  const dist = w.map((p) => Math.floor(p * total));
  const drift = total - dist.reduce((s, n) => s + n, 0);
  dist[0] += drift;
  return dist;
}

function versions(latest: string, count: number): CommunityVersion[] {
  const out: CommunityVersion[] = [];
  for (let i = 0; i < Math.min(count, 4); i++) {
    out.push({
      version: i === 0 ? latest : `${parseFloat(latest) - 0.1 * (i + 1)}`.slice(0, 5) + ".0",
      published_at: day(2 + i * 30),
      changelog: i === 0
        ? "Latest release — added 4 options, fixed weight rebalance."
        : "Maintenance release.",
    });
  }
  return out;
}

const COMMENT_POOL: Omit<CommunityComment, "id">[] = [
  { user: a("lila"),   body: "Drops in cleanly with the 1.4 engine — best I've tried.",       at: hr(4),  rating: 5 },
  { user: a("marlow"), body: "Solid. Wish there were more sub-categories for warm tones.",   at: hr(20), rating: 4 },
  { user: a("pixelnaut"), body: "Stars deserved. README walks through pipeline integration.", at: day(2), rating: 5 },
  { user: a("dax-prompts"), body: "Mixed — some options feel redundant. Trim next version?",  at: day(5), rating: 3 },
  { user: a("anya-vox"), body: "Beautiful curation. Pairs with my Cinematic pack.",          at: day(7), rating: 5 },
];

function seededComments(seed: number): CommunityComment[] {
  const n = 2 + (seed % 3);
  return COMMENT_POOL.slice(0, n).map((c, i) => ({ ...c, id: `cm_${seed}_${i}` }));
}

interface ModuleSeed {
  id: string;
  type: CommunityKind;
  name: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  author: CommunityUser;
  stars: number;
  downloads: number;
  rating: number;
  rating_count: number;
  nsfw?: boolean;
  license?: string;
  engine_min_version?: string;
  hero: string;
  preview: string[];
  updated: string;
  latest_version: string;
  version_count: number;
}

const MODULE_SEEDS: ModuleSeed[] = [
  {
    id: "wc_haircolor_pro", type: "wildcard", name: "Hair Color Pro",
    tagline: "120 hand-tuned hair colors with sub-categories.",
    description: "A meticulously curated wildcard covering warm, cool, and neutral hair tones.",
    category: "subject", tags: ["portrait", "fashion", "vibrant"],
    author: a("anya-vox"), stars: 612, downloads: 9810, rating: 4.7, rating_count: 188,
    hero: "linear-gradient(135deg, #b91c1c 0%, #facc15 100%)",
    preview: ["auburn", "chestnut", "platinum blonde", "raven black", "ash brown", "rose gold", "honey blonde"],
    updated: hr(11), latest_version: "1.3.2", version_count: 12,
  },
  {
    id: "wc_weather_xl", type: "wildcard", name: "Weather XL",
    tagline: "30 weather variants with humidity and temperature tags.",
    description: "Drop-in weather wildcard tuned for photoreal and concept-art pipelines.",
    category: "weather", tags: ["weather", "scene", "photoreal"],
    author: a("mira.lab"), stars: 482, downloads: 7140, rating: 4.6, rating_count: 142,
    hero: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
    preview: ["light rain", "thunderstorm", "dense fog", "snow flurries", "summer haze", "golden hour mist"],
    updated: hr(38), latest_version: "0.9.4", version_count: 6,
  },
  {
    id: "wc_lighting_neon", type: "wildcard", name: "Neon Lighting Mood",
    tagline: "Cyberpunk-friendly lighting wildcard — 22 options.",
    description: "Magenta, cyan, ultraviolet — all carefully balanced for late-night scenes.",
    category: "lighting", tags: ["cinematic", "vibrant", "sci-fi", "concept-art"],
    author: a("dax-prompts"), stars: 318, downloads: 5390, rating: 4.5, rating_count: 96,
    hero: "linear-gradient(135deg, #ec4899 0%, #6366f1 50%, #06b6d4 100%)",
    preview: ["magenta backlight", "cyan rim light", "ultraviolet wash", "split-tone neon", "chromatic flare"],
    updated: day(1), latest_version: "1.1.0", version_count: 4,
  },
  {
    id: "wc_pose_dramatic", type: "wildcard", name: "Dramatic Poses",
    tagline: "Twelve film-grade dramatic poses for editorial.",
    description: "Curated by editorial photographers; weighted for natural mid-stride feel.",
    category: "subject", tags: ["fashion", "cinematic"],
    author: a("kaito.studio"), stars: 142, downloads: 2840, rating: 4.4, rating_count: 38,
    hero: "linear-gradient(135deg, #312e81 0%, #db2777 100%)",
    preview: ["windswept profile", "over-shoulder glance", "mid-stride confident"],
    updated: day(9), latest_version: "1.0.2", version_count: 2,
  },
  {
    id: "wc_nsfw_lingerie", type: "wildcard", name: "Lingerie Editorial",
    tagline: "Editorial-style lingerie wardrobe wildcard. 18+.",
    description: "Editorial-only lingerie wardrobe. NSFW gated by registry policy.",
    category: "outfit", tags: ["fashion", "nsfw"], nsfw: true, license: "Proprietary",
    author: a("dax-prompts"), stars: 92, downloads: 1280, rating: 4.1, rating_count: 24,
    hero: "linear-gradient(135deg, #831843 0%, #1f1f1f 100%)",
    preview: ["[hidden — enable NSFW to preview]"],
    updated: day(6), latest_version: "0.5.0", version_count: 1,
  },
  {
    id: "wc_anime_subjects", type: "wildcard", name: "Anime Subjects",
    tagline: "60 anime archetypes with classic stat-block tags.",
    description: "Cel-shaded archetypes that mix cleanly with Ghibli and cyberpunk packs.",
    category: "subject", tags: ["anime", "concept-art"],
    author: a("pixelnaut"), stars: 246, downloads: 3210, rating: 4.4, rating_count: 70,
    hero: "linear-gradient(135deg, #f97316 0%, #fb7185 100%)",
    preview: ["mecha pilot", "magical girl", "shounen rival", "side-character cook"],
    updated: day(3), latest_version: "0.7.1", version_count: 3,
  },
  {
    id: "wc_outfits_streetwear", type: "wildcard", name: "Streetwear Outfits",
    tagline: "Modern streetwear — 80 looks across 5 sub-styles.",
    description: "Tuned for editorial / fashion shoots. Pairs nicely with Studio Photo Pack.",
    category: "outfit", tags: ["fashion", "studio"],
    author: a("lila"), stars: 191, downloads: 4120, rating: 4.5, rating_count: 51,
    hero: "linear-gradient(135deg, #0f766e 0%, #1e293b 100%)",
    preview: ["oversized hoodie", "tech jacket", "varsity coat", "pleated trousers"],
    updated: day(4), latest_version: "1.2.0", version_count: 4,
  },
  {
    id: "wc_scene_locations", type: "wildcard", name: "Scene Locations",
    tagline: "120 scene backdrops across urban / nature / liminal.",
    description: "Anchor your prompts to a real-feeling location. Engine 1.4+.",
    category: "scene", tags: ["scene", "cinematic", "photoreal"],
    author: a("kaito.studio"), stars: 540, downloads: 8410, rating: 4.7, rating_count: 132,
    hero: "linear-gradient(135deg, #0c4a6e 0%, #0ea5e9 100%)",
    preview: ["abandoned subway platform", "rooftop laundry line", "winter playground at dawn"],
    updated: day(2), latest_version: "2.0.1", version_count: 5,
  },
  {
    id: "fv_brand_palette", type: "fixed_values", name: "Brand Palette — Aurora",
    tagline: "Aurora studio palette + standard quality tags.",
    description: "Lock in your brand colors and quality tail in one drop-in module.",
    category: "style", tags: ["pastel", "studio"], license: "CC0",
    author: a("lila"), stars: 41, downloads: 720, rating: 4.2, rating_count: 12,
    hero: "linear-gradient(135deg, #c4b5fd 0%, #67e8f9 100%)",
    preview: ["$primary=#8b5cf6", "$secondary=#22d3ee", "$tail=ultra-detailed, sharp focus"],
    updated: day(20), latest_version: "1.0.0", version_count: 1,
  },
  {
    id: "fv_lens_pack", type: "fixed_values", name: "Lens Pack Plus",
    tagline: "Twelve canonical lens-bias presets (50/85/35/24...).",
    description: "Lock the camera identity per pipeline. Battle-tested at studio scale.",
    category: "camera", tags: ["photoreal", "studio"],
    author: a("penumbra-co"), stars: 280, downloads: 4810, rating: 4.7, rating_count: 78,
    hero: "linear-gradient(135deg, #475569 0%, #1e293b 100%)",
    preview: ["50mm f/1.8", "85mm f/1.4", "35mm f/2"],
    updated: day(15), latest_version: "2.0.0", version_count: 4,
  },
  {
    id: "fv_quality_tail", type: "fixed_values", name: "Quality Tail Master",
    tagline: "Battle-tested quality / negative tail used by 1k+ pipelines.",
    description: "Keep your default render quality consistent across pipelines.",
    category: "style", tags: ["post-process", "studio"],
    author: a("penumbra-co"), stars: 1200, downloads: 18230, rating: 4.9, rating_count: 412,
    hero: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
    preview: ["ultra-detailed", "sharp focus", "studio quality"],
    updated: day(11), latest_version: "3.1.0", version_count: 8,
  },
  {
    id: "cmb_subject_phrase", type: "combine", name: "Subject Phrase Builder",
    tagline: "Composes natural-sounding subject sentences.",
    description: "Stitches subject + outfit + pose into a clean clause.",
    category: "subject", tags: ["portrait", "post-process"],
    author: a("marlow"), stars: 178, downloads: 3210, rating: 4.4, rating_count: 54,
    hero: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
    preview: [
      "A 29-year-old with auburn hair, wearing a tailored tuxedo",
      "A 47-year-old with platinum hair, wearing an evening gown",
    ],
    updated: day(7), latest_version: "1.0.4", version_count: 3,
  },
  {
    id: "cmb_scene_assembler", type: "combine", name: "Scene Assembler",
    tagline: "Assembles location + lighting + weather into a single scene clause.",
    description: "Drop-in scene builder — pairs naturally with Scene Locations + Weather XL.",
    category: "scene", tags: ["scene", "cinematic"],
    author: a("kaito.studio"), stars: 322, downloads: 5910, rating: 4.7, rating_count: 88,
    hero: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
    preview: ["abandoned subway platform, dim fluorescents, dense fog"],
    updated: day(4), latest_version: "1.1.0", version_count: 4,
  },
  {
    id: "cmb_outfit_phrase", type: "combine", name: "Outfit Phrase",
    tagline: "Builds wardrobe sentences from sub-modules.",
    description: "Composes natural outfit clauses — handles plurals + commas.",
    category: "outfit", tags: ["fashion"],
    author: a("anya-vox"), stars: 84, downloads: 1410, rating: 4.3, rating_count: 22,
    hero: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
    preview: ["wearing a tailored blazer over a silk camisole"],
    updated: day(13), latest_version: "0.6.2", version_count: 2,
  },
  {
    id: "drv_negative_guard", type: "derivation", name: "Negative Guard XL",
    tagline: "Always-on anatomy + quality negatives. Battle-tested.",
    description: "Drop-in negative-prompt derivation. Used by 1k+ pipelines.",
    category: "style", tags: ["negative", "post-process"],
    author: a("penumbra-co"), stars: 1610, downloads: 22140, rating: 4.9, rating_count: 488,
    hero: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
    preview: ["extra fingers, distorted hands", "blurry, jpeg artifacts", "low-res, mutated"],
    updated: day(4), latest_version: "4.2.1", version_count: 14,
  },
  {
    id: "drv_wet_weather", type: "derivation", name: "Wet Weather Adjustments",
    tagline: "Drop-in postprocess: rain → wet clothes, fog → dewy.",
    description: "Sets up automatic appearance adjustments based on weather wildcards.",
    category: "weather", tags: ["weather", "post-process"],
    author: a("mira.lab"), stars: 218, downloads: 3640, rating: 4.6, rating_count: 64,
    hero: "linear-gradient(135deg, #0369a1 0%, #1e293b 100%)",
    preview: ['if rain → append "wet clothes, soaked hair"', 'if fog → append "damp hair, dewy skin"'],
    updated: day(10), latest_version: "1.2.0", version_count: 5,
  },
  {
    id: "drv_studio_lighting", type: "derivation", name: "Studio Lighting Bias",
    tagline: "Bias scene lighting toward studio softboxes when camera = studio.",
    description: "Cohesive lighting derivation — auto-applies softbox / rim cues.",
    category: "lighting", tags: ["studio", "photoreal"],
    author: a("penumbra-co"), stars: 412, downloads: 6210, rating: 4.7, rating_count: 110,
    hero: "linear-gradient(135deg, #475569 0%, #0f172a 100%)",
    preview: ["softbox key light", "rim light", "hair light"],
    updated: day(8), latest_version: "2.0.0", version_count: 6,
  },
  {
    id: "cn_palette", type: "constraint", name: "Palette Coherence",
    tagline: "Bias matrix between hair × outfit color families.",
    description: "Reduces clashing palettes; gentle nudges, not hard locks.",
    category: "style", tags: ["fashion", "post-process"],
    author: a("anya-vox"), stars: 96, downloads: 1840, rating: 4.3, rating_count: 28,
    hero: "linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #8b5cf6 100%)",
    preview: ["warm × cool → reduce", "rose gold × tuxedo → boost (override)"],
    updated: day(11), latest_version: "0.4.0", version_count: 2,
  },
  {
    id: "cn_subject_outfit", type: "constraint", name: "Subject × Outfit Match",
    tagline: "Keeps subject archetypes paired with realistic outfit choices.",
    description: "Cuts down on out-of-genre outfit pairings. Edit-friendly.",
    category: "subject", tags: ["fashion", "studio"],
    author: a("kaito.studio"), stars: 168, downloads: 2410, rating: 4.5, rating_count: 41,
    hero: "linear-gradient(135deg, #db2777 0%, #4c1d95 100%)",
    preview: ["mecha pilot × evening gown → reduce", "shounen rival × tuxedo → boost"],
    updated: day(6), latest_version: "1.0.0", version_count: 3,
  },
  {
    id: "pl_editorial", type: "pipeline", name: "Editorial Portrait Pipeline",
    tagline: "Production-ready editorial portrait pipeline — 8 modules.",
    description: "Drop-in pipeline preset for editorial portraits. Studio-ready.",
    category: "subject", tags: ["studio", "fashion", "photoreal"],
    author: a("penumbra-co"), stars: 514, downloads: 7320, rating: 4.8, rating_count: 122,
    hero: "linear-gradient(135deg, #1e293b 0%, #312e81 100%)",
    preview: ["full editorial portrait pipeline", "8 wired modules"],
    updated: day(2), latest_version: "2.0.0", version_count: 4,
  },
  {
    id: "pl_anime_starter", type: "pipeline", name: "Anime Starter Pipeline",
    tagline: "Beginner-friendly anime pipeline — 6 modules wired.",
    description: "Best on engine 1.4. Includes Anime Subjects + Streetwear + Studio Lighting.",
    category: "style", tags: ["anime", "concept-art"],
    author: a("pixelnaut"), stars: 244, downloads: 4320, rating: 4.5, rating_count: 71,
    hero: "linear-gradient(135deg, #fb7185 0%, #f97316 100%)",
    preview: ["Anime Subjects → Streetwear → Studio Lighting → Quality Tail"],
    updated: day(3), latest_version: "0.7.0", version_count: 3,
  },
  {
    id: "wc_emotions_basic", type: "wildcard", name: "Basic Emotions",
    tagline: "16 facial-expression keywords — clean and minimal.",
    description: "A safe baseline expression wildcard for any portrait pipeline.",
    category: "subject", tags: ["portrait"],
    author: a("marlow"), stars: 58, downloads: 1140, rating: 4.0, rating_count: 18,
    hero: "linear-gradient(135deg, #475569 0%, #1e1b4b 100%)",
    preview: ["serene", "amused", "stoic", "wistful"],
    updated: day(18), latest_version: "1.0.0", version_count: 1,
  },
  {
    id: "wc_camera_angles", type: "wildcard", name: "Camera Angles Pro",
    tagline: "Pro camera angle wildcard. 20 options + presets.",
    description: "Great pair with Lens Pack. Handles dutch + low-angle + worm's eye.",
    category: "camera", tags: ["studio", "photoreal", "cinematic"],
    author: a("dax-prompts"), stars: 312, downloads: 4910, rating: 4.6, rating_count: 71,
    hero: "linear-gradient(135deg, #1e293b 0%, #475569 100%)",
    preview: ["worm's eye", "dutch tilt", "high angle", "over the shoulder"],
    updated: day(5), latest_version: "1.4.0", version_count: 5,
  },
  {
    id: "wc_fantasy_subjects", type: "wildcard", name: "Fantasy Subjects",
    tagline: "Classic high-fantasy archetypes — 50 entries.",
    description: "Adventurers, mages, beasts — all with class & race flavor.",
    category: "subject", tags: ["fantasy", "concept-art"],
    author: a("kaito.studio"), stars: 388, downloads: 5610, rating: 4.6, rating_count: 92,
    hero: "linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)",
    preview: ["elven ranger", "tiefling warlock", "stoic dwarf paladin"],
    updated: day(7), latest_version: "1.5.0", version_count: 6,
  },
  {
    id: "wc_noir_lighting", type: "wildcard", name: "Noir Lighting",
    tagline: "Hard shadows + venetian blinds + smoke. 18 options.",
    description: "Drop-in noir lighting moodboard. Pairs with Cinematic Vol. 1.",
    category: "lighting", tags: ["noir", "cinematic", "monochrome"],
    author: a("kaito.studio"), stars: 174, downloads: 2810, rating: 4.5, rating_count: 41,
    hero: "linear-gradient(135deg, #0f172a 0%, #1f1f1f 100%)",
    preview: ["venetian-blind shadows", "single-source key", "smoke-diffused fill"],
    updated: day(12), latest_version: "1.0.0", version_count: 2,
  },
  {
    id: "wc_ghibli_scenes", type: "wildcard", name: "Ghibli Scenes",
    tagline: "Watercolor Ghibli vibes — 24 scene tags.",
    description: "Soft palette, hand-drawn flavor. Best with Anime Studio Starter.",
    category: "scene", tags: ["ghibli", "anime", "pastel"],
    author: a("pixelnaut"), stars: 408, downloads: 6510, rating: 4.7, rating_count: 102,
    hero: "linear-gradient(135deg, #5eead4 0%, #fde68a 100%)",
    preview: ["sun-dappled meadow", "spirit-filled forest", "rainy bus stop at dusk"],
    updated: day(4), latest_version: "1.2.0", version_count: 3,
  },
  {
    id: "fv_locked_camera", type: "fixed_values", name: "Locked Studio Camera",
    tagline: "Locked studio camera defaults — softbox, 85mm, eye-level.",
    description: "Lock-in baseline camera identity for studio shoots.",
    category: "camera", tags: ["studio", "photoreal"],
    author: a("penumbra-co"), stars: 88, downloads: 1612, rating: 4.4, rating_count: 24,
    hero: "linear-gradient(135deg, #404040 0%, #171717 100%)",
    preview: ["$lens=85mm f/1.4", "$key=softbox", "$angle=eye-level"],
    updated: day(20), latest_version: "1.0.1", version_count: 2,
  },
  {
    id: "drv_portrait_polish", type: "derivation", name: "Portrait Polish",
    tagline: "Auto-tunes skin / hair quality based on subject choice.",
    description: "Subtle polish for portrait pipelines.",
    category: "style", tags: ["portrait", "post-process"],
    author: a("anya-vox"), stars: 188, downloads: 2810, rating: 4.5, rating_count: 38,
    hero: "linear-gradient(135deg, #b91c1c 0%, #4c1d95 100%)",
    preview: ['if subject = portrait → append "skin pores, gentle subsurface"'],
    updated: day(9), latest_version: "1.1.0", version_count: 3,
  },
  {
    id: "cn_genre_bias", type: "constraint", name: "Genre Bias",
    tagline: "Soft constraint to keep cross-genre choices coherent.",
    description: "Gentle nudges between fantasy / sci-fi / photoreal axes.",
    category: "style", tags: ["fantasy", "sci-fi"],
    author: a("dax-prompts"), stars: 110, downloads: 1340, rating: 4.4, rating_count: 21,
    hero: "linear-gradient(135deg, #4c1d95 0%, #312e81 100%)",
    preview: ["sci-fi × medieval → reduce", "fantasy × cyberpunk → boost (override)"],
    updated: day(14), latest_version: "0.5.0", version_count: 1,
  },
];

interface BundleSeed {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  author: CommunityUser;
  stars: number;
  downloads: number;
  rating: number;
  rating_count: number;
  hero: string;
  sub_kinds: CommunityKind[];
  module_ids: string[];
  preview_samples: string[];
  updated: string;
  latest_version: string;
  version_count: number;
}

const BUNDLE_SEEDS: BundleSeed[] = [
  {
    id: "pkg_cinematic", name: "Cinematic Vol. 1",
    tagline: "Weather-aware moody scene pack — 14 modules, drop-in pipeline.",
    description: "A complete cinematic pipeline including moody weather, scene locations, and noir lighting.",
    category: "lighting", tags: ["cinematic", "scene", "weather", "noir"],
    author: a("kaito.studio"), stars: 1240, downloads: 18420, rating: 4.8, rating_count: 312,
    hero: "linear-gradient(135deg, #312e81 0%, #0f172a 60%, #1e1b4b 100%)",
    sub_kinds: ["pipeline", "wildcard", "combine", "derivation"],
    module_ids: ["wc_scene_locations", "wc_weather_xl", "wc_noir_lighting", "cmb_scene_assembler"],
    preview_samples: ["overcast Tokyo at dusk", "neon-lit alley after rain", "fog-rolling mountain pass"],
    updated: day(2), latest_version: "2.1.0", version_count: 7,
  },
  {
    id: "pkg_studio", name: "Studio Photo Pack",
    tagline: "Locked studio camera defaults + 9 pose wildcards.",
    description: "Plug-and-play studio pack for editorial / fashion shoots.",
    category: "camera", tags: ["studio", "photoreal", "fashion"],
    author: a("penumbra-co"), stars: 988, downloads: 14210, rating: 4.9, rating_count: 274,
    hero: "linear-gradient(135deg, #404040 0%, #171717 100%)",
    sub_kinds: ["fixed_values", "wildcard", "combine"],
    module_ids: ["fv_locked_camera", "wc_pose_dramatic", "wc_outfits_streetwear"],
    preview_samples: ["seated 3/4", "leaning against wall", "candid laughter"],
    updated: day(5), latest_version: "3.0.0", version_count: 5,
  },
  {
    id: "pkg_anime", name: "Anime Studio Starter",
    tagline: "Ghibli + cyberpunk wildcards, paired pose pack.",
    description: "A friendly starter pack for anime-style pipelines.",
    category: "style", tags: ["anime", "ghibli", "concept-art"],
    author: a("pixelnaut"), stars: 244, downloads: 4320, rating: 4.5, rating_count: 71,
    hero: "linear-gradient(135deg, #fb7185 0%, #f97316 100%)",
    sub_kinds: ["wildcard", "combine"],
    module_ids: ["wc_anime_subjects", "wc_ghibli_scenes"],
    preview_samples: ["studio ghibli watercolor", "cyberpunk concept art", "cel-shaded character"],
    updated: day(3), latest_version: "0.7.0", version_count: 3,
  },
];

function buildModule(seed: ModuleSeed): CommunityModule {
  const license = seed.license ?? "MIT";
  const engine = seed.engine_min_version ?? "1.4";
  const versionList = versions(seed.latest_version, seed.version_count);
  return {
    id: seed.id,
    type: seed.type,
    name: seed.name,
    description: seed.description,
    category: seed.category,
    tags: seed.tags,
    author: seed.author,
    versions: versionList,
    stars: seed.stars,
    downloads: seed.downloads,
    rating: seed.rating,
    rating_count: seed.rating_count,
    rating_dist: ratingDist(seed.rating, seed.rating_count),
    nsfw: seed.nsfw ?? false,
    engine_min_version: engine,
    license,
    hero: seed.hero,
    tagline: seed.tagline,
    readme: defaultReadme({
      name: seed.name, author: seed.author, license, engine, kind: seed.type, tagline: seed.tagline, tags: seed.tags,
    }),
    updated_at: seed.updated,
    preview_options: seed.preview.map((v, i) => ({ value: v, weight: Math.max(1, 6 - i) })),
    comments: seededComments(seed.id.charCodeAt(4) || 0),
  };
}

function buildBundle(seed: BundleSeed, modules: CommunityModule[]): CommunityBundle {
  const license = "MIT";
  const engine = "1.4";
  const versionList = versions(seed.latest_version, seed.version_count);
  const includedModules = seed.module_ids
    .map((id) => modules.find((m) => m.id === id))
    .filter((m): m is CommunityModule => Boolean(m));
  return {
    id: seed.id,
    type: "bundle",
    name: seed.name,
    description: seed.description,
    tagline: seed.tagline,
    category: seed.category,
    tags: seed.tags,
    author: seed.author,
    versions: versionList,
    stars: seed.stars,
    downloads: seed.downloads,
    rating: seed.rating,
    rating_count: seed.rating_count,
    rating_dist: ratingDist(seed.rating, seed.rating_count),
    nsfw: false,
    engine_min_version: engine,
    license,
    hero: seed.hero,
    readme: defaultReadme({
      name: seed.name, author: seed.author, license, engine, kind: "bundle", tagline: seed.tagline, tags: seed.tags,
    }),
    updated_at: seed.updated,
    modules: includedModules,
    sub_kinds: seed.sub_kinds,
    preview_samples: seed.preview_samples,
    comments: seededComments(seed.id.charCodeAt(4) || 0),
  };
}

function defaultReadme(info: {
  name: string; author: CommunityUser; license: string; engine: string;
  kind: CommunityKind | "bundle"; tagline: string; tags: string[];
}): string {
  return [
    `# ${info.name}`,
    "",
    info.tagline,
    "",
    `**Author** · @${info.author.login} ${info.author.verified ? "✓" : ""}`,
    `**License** · ${info.license}  ·  **Engine** · ≥ ${info.engine}  ·  **Kind** · ${info.kind}`,
    "",
    "## What's inside",
    `Drop-in ${info.kind} module${info.kind === "bundle" ? " bundle" : ""}. Tags: ${info.tags.join(", ")}.`,
    "",
    "## Install",
    "Click **Install** above. The module is added to your local library and is then editable like any other.",
    "",
    "## Notes",
    "- Snapshot is captured on insert — saved workflows stay reproducible regardless of registry updates.",
    "- Re-sync from the module's detail page to pull the latest version.",
  ].join("\n");
}

const SEED_MODULES: CommunityModule[] = MODULE_SEEDS.map(buildModule);
const SEED_BUNDLES: CommunityBundle[] = BUNDLE_SEEDS.map((b) => buildBundle(b, SEED_MODULES));

export const SEED_ATOMS: CommunityAtom[] = [...SEED_BUNDLES, ...SEED_MODULES];

export const SEED_FEATURED_IDS = ["pkg_cinematic", "wc_haircolor_pro", "pkg_studio", "wc_weather_xl"];

export { SEED_MODULES, SEED_BUNDLES };
