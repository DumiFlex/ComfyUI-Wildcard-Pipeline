/* global React, WP_DATA, makeId */
// Community — mock data layer for the public registry + a lightweight
// fake API client. Mirrors what the real /community/api would look like.
const COMMUNITY = (() => {
  const now = Date.now();
  const day = (n) => now - n * 86_400_000;
  const hr  = (n) => now - n * 3_600_000;
  const min = (n) => now - n * 60_000;

  // ----- Authors -----
  const authors = [
    { id: "u_anya",   handle: "anya-vox",        name: "Anya Voskresenskaya", avatar: "🦊", verified: true,  joined: day(420) },
    { id: "u_kaito",  handle: "kaito.studio",    name: "Kaito",               avatar: "🐉", verified: true,  joined: day(310) },
    { id: "u_marlow", handle: "marlow",          name: "Sam Marlow",          avatar: "🐢", verified: false, joined: day(120) },
    { id: "u_mira",   handle: "mira.lab",        name: "Mira Lab",            avatar: "🌒", verified: true,  joined: day(580) },
    { id: "u_pix",    handle: "pixelnaut",       name: "pixelnaut",           avatar: "🐙", verified: false, joined: day(38)  },
    { id: "u_pen",    handle: "penumbra-co",     name: "Penumbra Co.",        avatar: "🌑", verified: true,  joined: day(700) },
    { id: "u_lila",   handle: "lila",            name: "Lila Tran",           avatar: "🦋", verified: false, joined: day(64)  },
    { id: "u_dax",    handle: "dax-prompts",     name: "Dax",                 avatar: "🦅", verified: true,  joined: day(200) },
  ];

  // ----- Tags -----
  const TAGS = [
    "portrait", "scene", "lighting", "cinematic", "studio",
    "nsfw", "anime", "photoreal", "concept-art", "fashion",
    "weather", "post-process", "negative", "fantasy", "sci-fi",
    "ghibli", "noir", "vibrant", "pastel", "monochrome",
  ];

  // ----- Featured curation list (picked by id below) -----
  const FEATURED = ["pkg_cinematic", "mod_haircolor_pro", "pkg_studio", "mod_weather_xl"];

  // Helper to seed a deterministic-ish histogram
  const histo = (vals) => {
    const out = {};
    vals.forEach((v, i) => { out[v] = 30 - i * 4 + Math.floor(Math.random() * 5); });
    return out;
  };

  // ----- Modules (the registry catalog) -----
  // Each entry mirrors the user's local-library module shape but adds:
  // author, version, downloads, stars, rating, comments, NSFW, license, engineRange, readme, changelog.
  const modulesRaw = [
    { id: "pkg_cinematic", kind: "pack", name: "Cinematic Vol. 1", tagline: "Weather-aware moody scene pack — 14 modules, drop-in pipeline.",
      author: "u_kaito", category: "lighting", subKind: ["pipeline", "wildcard", "combine", "derivation"],
      tags: ["cinematic", "scene", "weather", "noir"], downloads: 18420, stars: 1240, rating: 4.8, ratings: 312,
      version: "2.1.0", versions: 7, updated: day(2), created: day(180), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #312e81 0%, #0f172a 60%, #1e1b4b 100%)",
      previewVals: ["overcast Tokyo at dusk", "neon-lit alley after rain", "fog-rolling mountain pass", "amber-lit diner counter", "snowy village morning"] },
    { id: "mod_haircolor_pro", kind: "wildcard", name: "Hair Color Pro", tagline: "120 hand-tuned hair colors with sub-categories.",
      author: "u_anya", category: "subject",
      tags: ["portrait", "fashion", "vibrant"], downloads: 9810, stars: 612, rating: 4.7, ratings: 188,
      version: "1.3.2", versions: 12, updated: hr(11), created: day(220), nsfw: false, license: "CC0", engineMin: "1.2",
      hero: "linear-gradient(135deg, #b91c1c 0%, #facc15 100%)",
      previewVals: ["auburn", "chestnut", "platinum blonde", "raven black", "ash brown", "rose gold", "honey blonde"] },
    { id: "pkg_studio", kind: "pack", name: "Studio Photo Pack", tagline: "Locked studio camera defaults + 9 pose wildcards.",
      author: "u_pen", category: "camera", subKind: ["fixed", "wildcard", "combine"],
      tags: ["studio", "photoreal", "fashion"], downloads: 14210, stars: 988, rating: 4.9, ratings: 274,
      version: "3.0.0", versions: 5, updated: day(5), created: day(640), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #404040 0%, #171717 100%)",
      previewVals: ["seated 3/4", "leaning against wall", "candid laughter", "hands in pockets", "looking over shoulder"] },
    { id: "mod_weather_xl", kind: "wildcard", name: "Weather XL", tagline: "30 weather variants with proper humidity / temperature tags.",
      author: "u_mira", category: "weather",
      tags: ["weather", "scene", "photoreal"], downloads: 7140, stars: 482, rating: 4.6, ratings: 142,
      version: "0.9.4", versions: 6, updated: hr(38), created: day(95), nsfw: false, license: "MIT", engineMin: "1.3",
      hero: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
      previewVals: ["light rain", "thunderstorm", "dense fog", "snow flurries", "summer haze", "golden hour mist"] },
    { id: "mod_lighting_neon", kind: "wildcard", name: "Neon Lighting Mood", tagline: "Cyberpunk-friendly lighting wildcard — 22 options.",
      author: "u_dax", category: "lighting",
      tags: ["cinematic", "vibrant", "sci-fi", "concept-art"], downloads: 5390, stars: 318, rating: 4.5, ratings: 96,
      version: "1.1.0", versions: 4, updated: day(1), created: day(60), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #ec4899 0%, #6366f1 50%, #06b6d4 100%)",
      previewVals: ["magenta backlight", "cyan rim light", "ultraviolet wash", "split-tone neon", "chromatic flare"] },
    { id: "cmb_subject_phrase", kind: "combine", name: "Subject Phrase Builder", tagline: "Composes natural-sounding subject sentences.",
      author: "u_marlow", category: "subject",
      tags: ["portrait", "post-process"], downloads: 3210, stars: 178, rating: 4.4, ratings: 54,
      version: "1.0.4", versions: 3, updated: day(7), created: day(45), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
      previewVals: ["A 29-year-old with auburn hair, wearing a tailored tuxedo", "A 47-year-old with platinum hair, wearing an evening gown"] },
    { id: "drv_negative_guard", kind: "derivation", name: "Negative Guard XL", tagline: "Always-on anatomy + quality negatives. Battle-tested.",
      author: "u_pen", category: "style",
      tags: ["negative", "post-process"], downloads: 22140, stars: 1610, rating: 4.9, ratings: 488,
      version: "4.2.1", versions: 14, updated: day(4), created: day(900), nsfw: false, license: "MIT", engineMin: "1.0",
      hero: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
      previewVals: ["extra fingers, distorted hands", "blurry, jpeg artifacts", "low-res, mutated"] },
    { id: "cn_palette", kind: "constraint", name: "Palette Coherence", tagline: "Bias matrix between hair × outfit color families.",
      author: "u_anya", category: "style",
      tags: ["fashion", "post-process"], downloads: 1840, stars: 96, rating: 4.3, ratings: 28,
      version: "0.4.0", versions: 2, updated: day(11), created: day(40), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #8b5cf6 100%)",
      previewVals: ["warm × cool → reduce", "rose gold × tuxedo → boost (override)"] },
    { id: "fv_brand_palette", kind: "fixed", name: "Brand Palette — Aurora", tagline: "Aurora studio palette + standard quality tags.",
      author: "u_lila", category: "style",
      tags: ["pastel", "studio"], downloads: 720, stars: 41, rating: 4.2, ratings: 12,
      version: "1.0.0", versions: 1, updated: day(20), created: day(20), nsfw: false, license: "CC0", engineMin: "1.4",
      hero: "linear-gradient(135deg, #c4b5fd 0%, #67e8f9 100%)",
      previewVals: ["$primary=#8b5cf6", "$secondary=#22d3ee", "$tail=ultra-detailed, sharp focus"] },
    { id: "pkg_anime", kind: "pack", name: "Anime Studio Starter", tagline: "Ghibli + cyberpunk wildcards, paired pose pack.",
      author: "u_pix", category: "style", subKind: ["wildcard", "combine"],
      tags: ["anime", "ghibli", "concept-art"], downloads: 4320, stars: 244, rating: 4.5, ratings: 71,
      version: "0.7.0", versions: 3, updated: day(3), created: day(80), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #fb7185 0%, #f97316 100%)",
      previewVals: ["studio ghibli watercolor", "cyberpunk concept art", "cel-shaded character"] },
    { id: "mod_pose_dramatic", kind: "wildcard", name: "Dramatic Poses", tagline: "Twelve film-grade dramatic poses for editorial.",
      author: "u_kaito", category: "subject",
      tags: ["fashion", "cinematic"], downloads: 2840, stars: 142, rating: 4.4, ratings: 38,
      version: "1.0.2", versions: 2, updated: day(9), created: day(70), nsfw: false, license: "MIT", engineMin: "1.4",
      hero: "linear-gradient(135deg, #312e81 0%, #db2777 100%)",
      previewVals: ["windswept profile", "over-shoulder glance", "mid-stride confident"] },
    { id: "mod_nsfw_lingerie", kind: "wildcard", name: "Lingerie Editorial", tagline: "Editorial-style lingerie wardrobe wildcard. 18+.",
      author: "u_dax", category: "outfit",
      tags: ["fashion", "nsfw"], downloads: 1280, stars: 92, rating: 4.1, ratings: 24,
      version: "0.5.0", versions: 1, updated: day(6), created: day(30), nsfw: true, license: "Proprietary", engineMin: "1.4",
      hero: "linear-gradient(135deg, #831843 0%, #1f1f1f 100%)",
      previewVals: ["[hidden — enable NSFW to preview]"] },
    { id: "mod_lens_pack", kind: "fixed", name: "Lens Pack Plus", tagline: "Twelve canonical lens-bias presets (50/85/35/24...).",
      author: "u_pen", category: "camera",
      tags: ["photoreal", "studio"], downloads: 4810, stars: 280, rating: 4.7, ratings: 78,
      version: "2.0.0", versions: 4, updated: day(15), created: day(310), nsfw: false, license: "MIT", engineMin: "1.0",
      hero: "linear-gradient(135deg, #475569 0%, #1e293b 100%)",
      previewVals: ["50mm f/1.8", "85mm f/1.4", "35mm f/2"] },
    { id: "drv_wet_weather", kind: "derivation", name: "Wet Weather Adjustments", tagline: "Drop-in postprocess: rain → wet clothes, fog → dewy.",
      author: "u_mira", category: "weather",
      tags: ["weather", "post-process"], downloads: 3640, stars: 218, rating: 4.6, ratings: 64,
      version: "1.2.0", versions: 5, updated: day(10), created: day(200), nsfw: false, license: "MIT", engineMin: "1.3",
      hero: "linear-gradient(135deg, #0369a1 0%, #1e293b 100%)",
      previewVals: ["if rain → append \"wet clothes, soaked hair\"", "if fog → append \"damp hair, dewy skin\""] },
  ];

  // Ratings histogram for review widget (5,4,3,2,1)
  const seedRatings = (avg, total) => {
    // build a believable distribution that averages roughly to `avg`
    const dist = [0, 0, 0, 0, 0];
    let remaining = total;
    const w = avg >= 4.5 ? [0.72, 0.21, 0.05, 0.015, 0.005]
            : avg >= 4.0 ? [0.55, 0.30, 0.10, 0.03, 0.02]
            : [0.35, 0.32, 0.20, 0.08, 0.05];
    for (let i = 0; i < 5; i++) { dist[i] = Math.floor(total * w[i]); remaining -= dist[i]; }
    dist[0] += remaining;
    return dist; // index 0 = 5★, 4 = 1★
  };

  const COMMENTS_POOL = [
    { author: "u_lila",   text: "Honestly the best one I've tried — drops in cleanly with the 1.4 engine.", at: hr(4),  rating: 5 },
    { author: "u_marlow", text: "Solid. Wish there were more sub-categories for the warm tones.",         at: hr(20), rating: 4 },
    { author: "u_pix",    text: "Stars are deserved. The README walks through pipeline integration well.", at: day(2), rating: 5 },
    { author: "u_dax",    text: "Mixed — some options feel redundant. Maybe trim the next version?",      at: day(5), rating: 3 },
    { author: "u_anya",   text: "Beautiful curation. Pairs perfectly with my Cinematic pack.",            at: day(7), rating: 5 },
    { author: "u_kaito",  text: "Engine 1.4 only — I'd add a fallback for 1.3 users.",                    at: day(9), rating: 4 },
  ];
  const CHANGELOG_POOL = [
    { v: "2.1.0", at: day(2),  notes: "Added 4 new options. Fixed weight balance on cool sub-category. Engine 1.4 compat." },
    { v: "2.0.0", at: day(40), notes: "Major restructure: split into sub-categories. Breaking change for legacy bindings." },
    { v: "1.4.1", at: day(80), notes: "Fixed typo in README. Tweaked default weights." },
    { v: "1.4.0", at: day(120), notes: "Initial public release." },
  ];

  const modules = modulesRaw.map((m) => ({
    ...m,
    ratingsDist: seedRatings(m.rating, m.ratings),
    options: (m.previewVals || []).map((v, i) => ({ value: v, weight: Math.max(1, 5 - i) })),
    readme: defaultReadme(m),
    comments: COMMENTS_POOL.slice(0, 3 + ((m.id.charCodeAt(4) || 0) % 3)).map((c) => ({ ...c })),
    changelog: CHANGELOG_POOL.slice(0, Math.min(m.versions, 4)),
    histogram: histo(m.previewVals || []),
  }));

  // Persisted (per-user) state. The real backend would key by GitHub user.
  // We just wrap localStorage so refreshes feel real.
  const STORAGE_KEY = "wp_community_state_v1";
  const loadState = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  };
  const saveState = (s) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} };

  // ---- Mock API (returns Promises with simulated latency) ----
  let apiOnline = true;
  const setApiOnline = (v) => { apiOnline = !!v; };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const api = {
    ping: async () => { await delay(120); if (!apiOnline) throw new Error("offline"); return { ok: true }; },
    list: async (q = {}) => {
      await delay(180);
      if (!apiOnline) throw new Error("offline");
      let out = modules.slice();
      if (q.kind && q.kind !== "all")     out = out.filter((m) => m.kind === q.kind);
      if (q.category)                      out = out.filter((m) => m.category === q.category);
      if (q.tag)                           out = out.filter((m) => m.tags.includes(q.tag));
      if (q.q) {
        const s = q.q.toLowerCase();
        out = out.filter((m) => (m.name + " " + m.tagline + " " + m.tags.join(" ")).toLowerCase().includes(s));
      }
      if (q.verifiedOnly)                  out = out.filter((m) => authors.find((a) => a.id === m.author)?.verified);
      if (!q.includeNsfw)                  out = out.filter((m) => !m.nsfw);
      if (q.compatibleOnly && q.engine)    out = out.filter((m) => engineSatisfies(q.engine, m.engineMin));
      const sort = q.sort || "trending";
      out.sort((a, b) => {
        if (sort === "stars")     return b.stars - a.stars;
        if (sort === "downloads") return b.downloads - a.downloads;
        if (sort === "recent")    return b.updated - a.updated;
        if (sort === "rating")    return b.rating - a.rating;
        // trending = blend of recent updates × stars
        return (b.stars * 0.6 + (1e10 / (now - b.updated)) * 0.4)
             - (a.stars * 0.6 + (1e10 / (now - a.updated)) * 0.4);
      });
      return out;
    },
    detail: async (id) => {
      await delay(220);
      if (!apiOnline) throw new Error("offline");
      const m = modules.find((x) => x.id === id);
      if (!m) { const e = new Error("not_found"); e.code = 404; throw e; }
      return m;
    },
    install:   async (id) => { await delay(450); if (!apiOnline) throw new Error("offline"); return { ok: true, id }; },
    uninstall: async (id) => { await delay(250); if (!apiOnline) throw new Error("offline"); return { ok: true, id }; },
    star:      async (id, on) => { await delay(180); if (!apiOnline) throw new Error("offline"); return { ok: true, id, on }; },
    publish:   async (payload) => { await delay(800); if (!apiOnline) throw new Error("offline"); return { ok: true, id: makeId("pub") }; },
    report:    async (id, reason) => { await delay(250); if (!apiOnline) throw new Error("offline"); return { ok: true }; },
    comment:   async (id, text, rating) => { await delay(250); if (!apiOnline) throw new Error("offline"); return { ok: true, id, text, rating, at: Date.now() }; },
    me:        async () => { await delay(140); if (!apiOnline) throw new Error("offline"); return null; }, // server-side; UI uses local state
  };

  function engineSatisfies(have, need) {
    const a = have.split(".").map(Number);
    const b = need.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return true;
  }

  function defaultReadme(m) {
    const a = authors.find((x) => x.id === m.author);
    return [
      `# ${m.name}`,
      ``,
      m.tagline,
      ``,
      `**Author** · @${a?.handle || "unknown"} ${a?.verified ? "✓" : ""}`,
      `**License** · ${m.license}  ·  **Engine** · ≥ ${m.engineMin}  ·  **Kind** · ${m.kind}`,
      ``,
      `## What's inside`,
      `Drop-in ${m.kind} module${m.kind === "pack" ? " bundle" : ""}. Tags: ${m.tags.join(", ")}.`,
      ``,
      `## Install`,
      `Click **Install** above. The module is added to your local library and is then editable like any other.`,
      ``,
      `## Notes`,
      `- Snapshot is captured on insert — saved workflows stay reproducible regardless of registry updates.`,
      `- Re-sync from the module's detail page to pull the latest version.`,
    ].join("\n");
  }

  return {
    authors, modules, FEATURED, TAGS,
    api, loadState, saveState, setApiOnline,
    engineSatisfies,
  };
})();

// Render a tiny markdown-ish blob (headings, bold, lists, code) without pulling a parser.
function renderMD(src) {
  const lines = String(src || "").split("\n");
  const out = [];
  let inList = false;
  const flushList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const inline = (t) =>
    t
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/(\B@[a-z0-9_.\-]+)/gi, '<span style="color:var(--wp-accent-text)">$1</span>');
  for (const ln of lines) {
    if (/^# /.test(ln))      { flushList(); out.push(`<h2>${inline(ln.slice(2))}</h2>`); continue; }
    if (/^## /.test(ln))     { flushList(); out.push(`<h3>${inline(ln.slice(3))}</h3>`); continue; }
    if (/^- /.test(ln))      { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(ln.slice(2))}</li>`); continue; }
    if (!ln.trim())          { flushList(); out.push("<p style=\"height:6px\"></p>"); continue; }
    flushList();
    out.push(`<p>${inline(ln)}</p>`);
  }
  flushList();
  return out.join("");
}

Object.assign(window, { COMMUNITY, renderMD });
