/* global React */
// Wildcard Pipeline — mock data + helpers shared across screens.

const WP_DATA = (() => {
  const now = Date.now();
  const min = (n) => now - n * 60_000;
  const hr = (n) => now - n * 3_600_000;
  const day = (n) => now - n * 86_400_000;

  // Stable short-uuid-style ids — 8 chars, lowercase hex/base36.
  const sid = (() => {
    let n = 0xa1b2c3;
    return () => {
      n = (n * 1664525 + 1013904223) >>> 0;
      return n.toString(36).padStart(8, "0").slice(-8);
    };
  })();
  const id = (prefix) => `${prefix}_${sid()}`;

  const categories = [
    { id: "cat_style",     name: "Style",       color: "#a78bfa" },
    { id: "cat_subject",   name: "Subject",     color: "#22d3ee" },
    { id: "cat_lighting",  name: "Lighting",    color: "#fbbf24" },
    { id: "cat_camera",    name: "Camera",      color: "#f472b6" },
    { id: "cat_weather",   name: "Weather",     color: "#60a5fa" },
    { id: "cat_outfit",    name: "Outfit",      color: "#34d399" },
    { id: "cat_pose",      name: "Pose",        color: "#fb923c" },
    { id: "cat_location",  name: "Location",    color: "#818cf8" },
    { id: "cat_mood",      name: "Mood",        color: "#f87171" },
    { id: "cat_props",     name: "Props",       color: "#94a3b8" },
  ];

  // Helper: snake_case-ify a name for default variable bindings.
  const toVar = (name) => name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");

  // ---------- Wildcards ----------
  const wildcardSpecs = [
    { name: "Hair Color",      cat: "cat_subject",  tags: ["character", "appearance"], subs: ["warm", "cool", "neutral"], updated: min(12), fav: true,
      opts: [
        { weight: 3, value: "auburn",          sub: "warm" },
        { weight: 2, value: "platinum blonde", sub: "cool" },
        { weight: 4, value: "raven black",     sub: "neutral" },
        { weight: 1, value: "rose gold",       sub: "warm" },
        { weight: 2, value: "ash brown",       sub: "neutral" },
        { weight: 1, value: "icy silver",      sub: "cool" },
      ] },
    { name: "Outfit",          cat: "cat_outfit",   tags: ["wardrobe"], subs: ["casual", "formal", "athletic"], updated: min(45),
      opts: [
        { weight: 2, value: "{linen|cotton} sundress",   sub: "casual" },
        { weight: 1, value: "tailored tuxedo",           sub: "formal" },
        { weight: 2, value: "oversized hoodie in @hair_color", sub: "casual" },
        { weight: 1, value: "running shorts and tank",   sub: "athletic" },
        { weight: 1, value: "{black|navy|emerald} evening gown", sub: "formal" },
        { weight: 1, value: "track jacket and leggings", sub: "athletic" },
      ] },
    { name: "Lighting Mood",   cat: "cat_lighting", tags: ["scene", "mood"], subs: ["soft", "dramatic", "natural"], updated: hr(2), fav: true,
      opts: [
        { weight: 3, value: "soft golden hour",                sub: "natural" },
        { weight: 2, value: "harsh noon sun",                   sub: "natural" },
        { weight: 2, value: "rim-lit silhouette, @time_of_day", sub: "dramatic" },
        { weight: 3, value: "diffused window light",            sub: "soft" },
        { weight: 1, value: "{neon|sodium-vapor|holographic}-soaked alley", sub: "dramatic" },
      ] },
    { name: "Camera Angle",    cat: "cat_camera",   tags: [], subs: [], updated: hr(8),
      opts: [
        { weight: 4, value: "low angle hero shot" },
        { weight: 3, value: "overhead flat-lay" },
        { weight: 2, value: "dutch tilt" },
        { weight: 5, value: "eye-level portrait" },
        { weight: 2, value: "over-the-shoulder" },
      ] },
    { name: "Weather",         cat: "cat_weather",  tags: ["environment"], subs: ["wet", "dry"], updated: day(1),
      opts: [
        { weight: 3, value: "drizzling rain",  sub: "wet" },
        { weight: 2, value: "thick fog",       sub: "wet" },
        { weight: 4, value: "clear skies",     sub: "dry" },
        { weight: 1, value: "blowing snow",    sub: "wet" },
        { weight: 2, value: "dusty heat",      sub: "dry" },
      ] },
    { name: "Art Style",       cat: "cat_style",    tags: ["render"], subs: [], updated: day(2), valid: false,
      opts: [
        { weight: 5, value: "photoreal" },
        { weight: 3, value: "studio ghibli watercolor" },
        { weight: 2, value: "cyberpunk concept art" },
        { weight: 1, value: "" },
      ] },
    { name: "Pose",            cat: "cat_pose",     tags: ["character"], subs: ["static", "dynamic"], updated: hr(6),
      opts: [
        { weight: 3, value: "leaning against wall, holding @accessory",  sub: "static" },
        { weight: 2, value: "mid-stride running",                        sub: "dynamic" },
        { weight: 2, value: "seated cross-legged",                       sub: "static" },
        { weight: 1, value: "mid-air leap, @expression",                 sub: "dynamic" },
      ] },
    { name: "Background",      cat: "cat_location", tags: ["scene"], subs: ["urban", "nature", "interior"], updated: day(3),
      opts: [
        { weight: 3, value: "rain-soaked {Tokyo|Osaka|Seoul} street", sub: "urban" },
        { weight: 2, value: "alpine pine forest under @weather",       sub: "nature" },
        { weight: 2, value: "sunlit loft apartment",                   sub: "interior" },
        { weight: 1, value: "rooftop helipad",                         sub: "urban" },
        { weight: 2, value: "desert canyon at @time_of_day",           sub: "nature" },
      ] },
    { name: "Expression",      cat: "cat_mood",     tags: ["face"], subs: [], updated: hr(20),
      opts: [
        { weight: 3, value: "subtle smile" },
        { weight: 2, value: "intense focus" },
        { weight: 2, value: "wistful gaze" },
        { weight: 1, value: "stifled laughter" },
      ] },
    { name: "Accessory",       cat: "cat_props",    tags: ["wardrobe"], subs: [], updated: day(5),
      opts: [
        { weight: 2, value: "round {wire|tortoise-shell} glasses" },
        { weight: 2, value: "silver pendant" },
        { weight: 1, value: "leather satchel" },
        { weight: 1, value: "vintage wristwatch" },
      ] },
    { name: "Skin Tone",       cat: "cat_subject",  tags: ["character", "appearance"], subs: ["warm", "cool", "neutral"], updated: hr(30),
      opts: [
        { weight: 2, value: "warm olive",     sub: "warm" },
        { weight: 2, value: "porcelain",      sub: "cool" },
        { weight: 3, value: "deep umber",     sub: "neutral" },
        { weight: 2, value: "sun-kissed tan", sub: "warm" },
        { weight: 1, value: "freckled fair",  sub: "cool" },
      ] },
    { name: "Eye Color",       cat: "cat_subject",  tags: ["character", "appearance"], subs: [], updated: day(2),
      opts: [
        { weight: 2, value: "hazel green" },
        { weight: 2, value: "ice blue" },
        { weight: 3, value: "deep brown" },
        { weight: 1, value: "amber" },
        { weight: 1, value: "violet" },
      ] },
    { name: "Time of Day",     cat: "cat_lighting", tags: ["scene"], subs: [], updated: day(4),
      opts: [
        { weight: 4, value: "golden hour" },
        { weight: 2, value: "blue hour" },
        { weight: 1, value: "high noon" },
        { weight: 2, value: "deep night" },
      ] },
    { name: "Lens",            cat: "cat_camera",   tags: ["photo"], subs: [], updated: day(7),
      opts: [
        { weight: 3, value: "85mm f/1.4 portrait" },
        { weight: 2, value: "24mm wide environmental" },
        { weight: 2, value: "50mm normal" },
        { weight: 1, value: "135mm tight crop" },
      ] },
    { name: "Composition",     cat: "cat_camera",   tags: ["framing"], subs: [], updated: hr(48),
      opts: [
        { weight: 3, value: "rule of thirds" },
        { weight: 2, value: "centered symmetrical" },
        { weight: 2, value: "leading lines" },
        { weight: 1, value: "negative space" },
      ] },
    { name: "Color Palette",   cat: "cat_style",    tags: ["render"], subs: ["warm", "cool", "muted"], updated: day(6),
      opts: [
        { weight: 2, value: "amber and crimson",   sub: "warm" },
        { weight: 2, value: "teal and ultraviolet",sub: "cool" },
        { weight: 2, value: "dusty pastels",       sub: "muted" },
        { weight: 1, value: "monochrome sepia",    sub: "muted" },
      ] },
    { name: "Render Quality",  cat: "cat_style",    tags: ["render"], subs: [], updated: day(10),
      opts: [
        { weight: 5, value: "ultra-detailed, 8k" },
        { weight: 2, value: "film grain, analog" },
        { weight: 1, value: "watercolor wash" },
      ] },
    { name: "Material",        cat: "cat_outfit",   tags: ["wardrobe"], subs: [], updated: day(8),
      opts: [
        { weight: 3, value: "raw selvedge denim" },
        { weight: 2, value: "boucle wool" },
        { weight: 2, value: "matte leather" },
        { weight: 1, value: "iridescent silk" },
      ] },
    { name: "Hairstyle",       cat: "cat_subject",  tags: ["character"], subs: ["short", "long", "tied"], updated: day(1),
      opts: [
        { weight: 2, value: "shoulder-length waves", sub: "long" },
        { weight: 2, value: "blunt bob",             sub: "short" },
        { weight: 2, value: "messy bun",             sub: "tied" },
        { weight: 1, value: "long braid",            sub: "tied" },
        { weight: 1, value: "buzzcut",               sub: "short" },
      ] },
    { name: "Footwear",        cat: "cat_outfit",   tags: ["wardrobe"], subs: [], updated: day(12),
      opts: [
        { weight: 2, value: "scuffed white sneakers" },
        { weight: 2, value: "leather oxfords" },
        { weight: 1, value: "platform boots" },
        { weight: 1, value: "barefoot" },
      ] },
    { name: "Architecture",    cat: "cat_location", tags: ["scene"], subs: ["modern", "historic"], updated: day(9),
      opts: [
        { weight: 2, value: "brutalist concrete",     sub: "modern" },
        { weight: 2, value: "victorian terrace",      sub: "historic" },
        { weight: 2, value: "minimalist scandi loft", sub: "modern" },
        { weight: 1, value: "ornate baroque cathedral", sub: "historic" },
      ] },
  ];

  const wildcards = wildcardSpecs.map((w) => ({
    id: id("wc"),
    name: w.name,
    category: w.cat,
    tags: w.tags,
    subCategories: w.subs,
    options: w.opts,
    updatedAt: w.updated,
    favorite: !!w.fav,
    valid: w.valid !== false,
    varBinding: toVar(w.name),
    history: [],
  }));

  // Add a rich history to one wildcard for demo.
  const hairColor = wildcards.find((w) => w.name === "Hair Color");
  if (hairColor) {
    hairColor.history = [
      { name: "Hair Color", category: "cat_subject",
        description: "Hair tones for portrait subjects.",
        tags: ["character", "appearance"],
        subCategories: ["warm", "cool", "neutral"],
        varBinding: "hair_color",
        options: hairColor.options.slice(0, 5),
        savedAt: hr(2) },
      { name: "Hair Color", category: "cat_subject",
        description: "",
        tags: ["character"],
        subCategories: ["warm", "cool"],
        varBinding: "hair_color",
        options: [
          { weight: 2, value: "auburn",          sub: "warm" },
          { weight: 2, value: "platinum blonde", sub: "cool" },
          { weight: 3, value: "raven black",     sub: "" },
        ],
        savedAt: day(1) },
      { name: "hair_color", category: "cat_subject",
        description: "",
        tags: [], subCategories: [],
        varBinding: "hair_color",
        options: [
          { weight: 1, value: "blonde",   sub: "" },
          { weight: 1, value: "brunette", sub: "" },
          { weight: 1, value: "black",    sub: "" },
        ],
        savedAt: day(3) },
    ];
  }

  // ---------- Fixed Values ----------
  const fixedValueSpecs = [
    { name: "Subject Profile", cat: "cat_subject", tags: ["character"], updated: min(33), fav: true,
      desc: "Canonical subject identity used across compositions.",
      values: [
        { var: "name", value: "Mira Voss" },
        { var: "age",  value: "29" },
        { var: "build", value: "athletic" },
        { var: "eyes", value: "hazel green" },
      ] },
    { name: "Location Tokyo",  cat: "cat_location", tags: ["scene"], updated: hr(4),
      desc: "Default location bindings — neon-Shibuya night.",
      values: [
        { var: "city",   value: "Tokyo" },
        { var: "ward",   value: "Shibuya" },
        { var: "season", value: "late autumn" },
      ] },
    { name: "Lens Pack 50mm",  cat: "cat_camera",   tags: ["photo"], updated: day(3),
      desc: "Studio prime lens defaults.",
      values: [
        { var: "focal",    value: "50mm" },
        { var: "aperture", value: "f/1.8" },
        { var: "iso",      value: "200" },
      ] },
    { name: "Subject Profile B", cat: "cat_subject", tags: ["character"], updated: hr(20),
      desc: "Alternate subject — older protagonist.",
      values: [
        { var: "name",  value: "Renata Iwasaki" },
        { var: "age",   value: "47" },
        { var: "build", value: "lean" },
        { var: "eyes",  value: "deep brown" },
      ] },
    { name: "Studio Defaults", cat: "cat_camera",  tags: ["photo", "studio"], updated: day(11),
      desc: "Common studio camera and grade settings.",
      values: [
        { var: "lens_focal", value: "85mm" },
        { var: "iso",        value: "100" },
        { var: "white_balance", value: "5500K" },
        { var: "grade",      value: "kodak portra" },
      ] },
    { name: "Negative Defaults", cat: "cat_style", tags: ["render"], updated: day(2), fav: true,
      desc: "Standard negative-prompt fragments.",
      values: [
        { var: "neg_anatomy", value: "extra fingers, distorted hands" },
        { var: "neg_style",   value: "blurry, jpeg artifacts" },
      ] },
    { name: "Brand Colors",    cat: "cat_style",   tags: ["palette"], updated: day(15),
      desc: "Project palette references.",
      values: [
        { var: "primary",   value: "#8b5cf6" },
        { var: "secondary", value: "#22d3ee" },
        { var: "accent",    value: "#fbbf24" },
      ] },
    { name: "Studio Tags",     cat: "cat_style",   tags: ["render"], updated: day(7),
      desc: "Shared quality-tag bundle.",
      values: [
        { var: "quality_tail", value: "ultra-detailed, sharp focus, professional photography" },
      ] },
    { name: "Location Paris",  cat: "cat_location",tags: ["scene"], updated: day(20),
      desc: "Paris seasonal defaults.",
      values: [
        { var: "city",   value: "Paris" },
        { var: "arrond", value: "11e" },
        { var: "season", value: "early spring" },
      ] },
  ];

  const fixedValues = fixedValueSpecs.map((f) => ({
    id: id("fv"),
    name: f.name,
    category: f.cat,
    description: f.desc,
    tags: f.tags,
    values: f.values,
    updatedAt: f.updated,
    favorite: !!f.fav,
    valid: true,
    history: [],
  }));

  // ---------- Combines ----------
  const combineSpecs = [
    { name: "Subject Phrase", cat: "cat_subject", tags: ["compose"], updated: hr(5), fav: true,
      desc: "Builds a natural subject sentence from upstream wildcards.",
      template: "$name, a $age-year-old with $hair_color hair, wearing $outfit",
      output: "subject_phrase" },
    { name: "Scene Setter",   cat: "cat_lighting", tags: ["scene"], updated: day(1),
      desc: "Combines weather and lighting into a cohesive scene clause.",
      template: "$weather under $lighting_mood, shot with $camera_angle",
      output: "scene_clause" },
    { name: "Style Tail",     cat: "cat_style",    tags: ["render"], updated: day(2),
      desc: "Quality and style tail appended to most prompts.",
      template: "$art_style, $color_palette, $quality_tail",
      output: "style_tail" },
    { name: "Camera Block",   cat: "cat_camera",   tags: ["photo"], updated: day(4),
      desc: "Camera settings clause.",
      template: "$lens at $aperture, ISO $iso, $composition",
      output: "camera_block" },
    { name: "Location Phrase",cat: "cat_location", tags: ["scene"], updated: day(6),
      desc: "Location with seasonal context.",
      template: "$city ($ward), $season",
      output: "location_phrase" },
  ];
  const combines = combineSpecs.map((c) => ({
    id: id("cb"),
    name: c.name,
    category: c.cat,
    description: c.desc,
    tags: c.tags,
    template: c.template,
    inputs: Array.from(new Set((c.template.match(/(?:^|[^$])\$([a-z_][a-z0-9_]*)/gi) || []).map((m) => "$" + m.match(/\$([a-z_][a-z0-9_]*)/i)[1]))),
    output: "$" + c.output,
    updatedAt: c.updated,
    favorite: !!c.fav,
    valid: true,
    history: [],
  }));

  // ---------- Derivations (independent rules, each with branches + optional else) ----------
  const derivationSpecs = [
    { name: "Wet-weather adjustments", cat: "cat_weather", tags: ["postprocess"], updated: hr(3), fav: true,
      desc: "Insert wet-clothing and reflection cues if the weather resolved to rain (and the user didn't ask for an umbrella).",
      rules: [
        { branches: [
            { condition: { kind: "contains", var: "weather", value: "rain" }, action: { kind: "append", target: "subject", value: "wet clothes, soaked hair" } },
            { condition: { kind: "contains", var: "weather", value: "fog" },  action: { kind: "append", target: "subject", value: "damp hair, dewy skin" } },
          ],
          hasElse: true,
          else: { kind: "append", target: "scene", value: "crisp dry detail" } },
        { branches: [
            { condition: { kind: "contains", var: "weather", value: "rain" }, action: { kind: "append", target: "scene", value: "reflective puddles" } },
          ],
          hasElse: false, else: { kind: "append", target: "scene", value: "" } },
      ] },
    { name: "Neon glow boost", cat: "cat_lighting", tags: ["postprocess", "scene"], updated: day(2),
      desc: "If lighting is neon, add reflective and chromatic flair.",
      rules: [
        { branches: [
            { condition: { kind: "contains", var: "lighting_mood", value: "neon" }, action: { kind: "append", target: "scene", value: "reflective puddles, chromatic aberration" } },
          ],
          hasElse: false, else: { kind: "append", target: "scene", value: "" } },
      ] },
    { name: "Negative anatomy guard", cat: "cat_style", tags: ["postprocess", "negative"], updated: day(5),
      desc: "Always inject anatomy and quality negatives.",
      rules: [
        { branches: [{ condition: { kind: "always" }, action: { kind: "append", target: "negative", value: "extra fingers, distorted hands" } }],
          hasElse: false, else: { kind: "append", target: "negative", value: "" } },
        { branches: [{ condition: { kind: "always" }, action: { kind: "append", target: "negative", value: "blurry, jpeg artifacts" } }],
          hasElse: false, else: { kind: "append", target: "negative", value: "" } },
      ] },
    { name: "Formal-attire scene swap", cat: "cat_outfit", tags: ["postprocess"], updated: day(3),
      desc: "Swap urban backgrounds for an indoor venue when subject wears formal attire.",
      rules: [
        { branches: [
            { condition: { kind: "contains", var: "outfit", value: "tuxedo" },       action: { kind: "replace", target: "scene", value: "ornate ballroom interior" } },
            { condition: { kind: "contains", var: "outfit", value: "evening gown" }, action: { kind: "replace", target: "scene", value: "marble gallery, soft uplighting" } },
          ],
          hasElse: false, else: { kind: "append", target: "scene", value: "" } },
      ] },
    { name: "Cool-palette mood lift", cat: "cat_mood", tags: ["postprocess"], updated: day(7),
      desc: "Subtle wistful tonality on cool color palettes; warmer warmth otherwise.",
      rules: [
        { branches: [
            { condition: { kind: "contains", var: "color_palette", value: "teal" }, action: { kind: "append", target: "subject", value: "wistful gaze" } },
          ],
          hasElse: true,
          else: { kind: "append", target: "subject", value: "subtle smile" } },
      ] },
  ];
  const derivations = derivationSpecs.map((d) => ({
    id: id("dv"),
    name: d.name,
    category: d.cat,
    description: d.desc,
    tags: d.tags,
    rules: d.rules,
    updatedAt: d.updated,
    favorite: !!d.fav,
    valid: true,
    history: [],
  }));

  // ---------- Constraints ----------
  const constraintSpecs = [
    { name: "Warm Hair × Cool Outfit", cat: "cat_style", tags: ["palette"], updated: hr(1),
      desc: "Bias warm-tone hair away from cool-tone outfits.",
      target: "Hair Color", source: "Outfit",
      matrix: [
        ["allow",   "exclude", "allow"],
        ["allow",   "allow",   "boost"],
        ["allow",   "allow",   "allow"],
      ],
      exceptions: [{ from: "rose gold", to: "tailored tuxedo", mode: "allow", note: "designer override" }] },
    { name: "Weather × Outfit Coherence", cat: "cat_weather", tags: ["coherence"], updated: day(1), fav: true,
      desc: "Reduce probability of light outfits on wet weather.",
      target: "Outfit", source: "Weather",
      matrix: [
        ["reduce", "allow"],
        ["allow",  "allow"],
        ["reduce", "allow"],
      ], exceptions: [] },
    { name: "Pose × Lighting Drama", cat: "cat_mood", tags: ["scene"], updated: day(2),
      desc: "Boost dramatic poses with dramatic lighting.",
      target: "Pose", source: "Lighting Mood",
      matrix: [
        ["allow", "reduce", "allow"],
        ["allow", "boost",  "allow"],
      ], exceptions: [] },
    { name: "Background × Time of Day", cat: "cat_location", tags: ["scene"], updated: day(4),
      desc: "Match interiors with daylight, urban with night.",
      target: "Background", source: "Time of Day",
      matrix: [],
      exceptions: [] },
  ];

  const constraints = constraintSpecs.map((c) => {
    const t = wildcards.find((w) => w.name === c.target);
    const s = wildcards.find((w) => w.name === c.source);
    return {
      id: id("cn"),
      name: c.name,
      category: c.cat,
      description: c.desc,
      tags: c.tags,
      target: t?.id,
      source: s?.id,
      matrix: c.matrix,
      exceptions: c.exceptions,
      updatedAt: c.updated,
      favorite: !!c.fav,
      valid: true,
      history: [],
    };
  });

  // ---------- Pipelines ----------
  // A Pipeline is an ordered preset of modules from any kind. They run top-to-bottom,
  // each appending to the resolved context the next module sees. Stored as an
  // array of { kind, refId } references — when serialized to a ComfyUI workflow,
  // each ref becomes a snapshot.
  const pipelineSpecs = [
    { name: "Portrait — Default",   cat: "cat_subject",  tags: ["portrait", "ready"], updated: min(8), fav: true,
      desc: "Standard character-portrait stack. Resolves subject, outfit, and lighting before composing the final phrase and adding negatives.",
      steps: [
        { kind: "fixed",      ref: "Subject Profile" },
        { kind: "wildcard",   ref: "Hair Color" },
        { kind: "wildcard",   ref: "Hairstyle" },
        { kind: "wildcard",   ref: "Outfit" },
        { kind: "wildcard",   ref: "Lighting Mood" },
        { kind: "constraint", ref: "Warm Hair × Cool Outfit" },
        { kind: "combine",    ref: "Subject Phrase" },
        { kind: "combine",    ref: "Style Tail" },
        { kind: "derivation", ref: "Negative anatomy guard" },
      ] },
    { name: "Cinematic Scene",         cat: "cat_lighting", tags: ["scene", "wip"], updated: hr(2),
      desc: "Builds a weather-aware cinematic scene with reflective post-processing on rain.",
      steps: [
        { kind: "fixed",      ref: "Location Tokyo" },
        { kind: "wildcard",   ref: "Weather" },
        { kind: "wildcard",   ref: "Time of Day" },
        { kind: "wildcard",   ref: "Lighting Mood" },
        { kind: "wildcard",   ref: "Camera Angle" },
        { kind: "wildcard",   ref: "Lens" },
        { kind: "combine",    ref: "Scene Setter" },
        { kind: "combine",    ref: "Camera Block" },
        { kind: "derivation", ref: "Wet-weather adjustments" },
        { kind: "derivation", ref: "Neon glow boost" },
      ] },
    { name: "Studio Photo Pack",       cat: "cat_camera",   tags: ["photo", "studio"], updated: day(1),
      desc: "Locked studio camera defaults with Pose / Composition variation.",
      steps: [
        { kind: "fixed",      ref: "Studio Defaults" },
        { kind: "wildcard",   ref: "Pose" },
        { kind: "wildcard",   ref: "Expression" },
        { kind: "wildcard",   ref: "Composition" },
        { kind: "combine",    ref: "Camera Block" },
        { kind: "derivation", ref: "Cool-palette mood lift" },
      ] },
    { name: "Editorial — Formal",  cat: "cat_outfit",   tags: ["editorial"], updated: day(3),
      desc: "Formal-attire editorial spread with venue-aware background swap.",
      steps: [
        { kind: "fixed",      ref: "Subject Profile B" },
        { kind: "wildcard",   ref: "Outfit" },
        { kind: "wildcard",   ref: "Footwear" },
        { kind: "wildcard",   ref: "Material" },
        { kind: "wildcard",   ref: "Background" },
        { kind: "wildcard",   ref: "Architecture" },
        { kind: "constraint", ref: "Weather × Outfit Coherence" },
        { kind: "derivation", ref: "Formal-attire scene swap" },
        { kind: "combine",    ref: "Subject Phrase" },
      ] },
    { name: "Concept Art — Cool",  cat: "cat_style",    tags: ["concept", "cool-tone"], updated: day(5),
      desc: "Cool-palette concept-art exploration with mood lift.",
      steps: [
        { kind: "wildcard",   ref: "Art Style" },
        { kind: "wildcard",   ref: "Color Palette" },
        { kind: "wildcard",   ref: "Render Quality" },
        { kind: "constraint", ref: "Pose × Lighting Drama" },
        { kind: "derivation", ref: "Cool-palette mood lift" },
        { kind: "combine",    ref: "Style Tail" },
      ] },
    { name: "Negative-only base",      cat: "cat_style",    tags: ["utility"], updated: day(8), valid: true,
      desc: "Reusable base — only injects negative prompt fragments.",
      steps: [
        { kind: "fixed",      ref: "Negative Defaults" },
        { kind: "derivation", ref: "Negative anatomy guard" },
      ] },
  ];

  const findRef = (kind, name) => {
    const list = { wildcard: wildcards, fixed: fixedValues, combine: combines, derivation: derivations, constraint: constraints }[kind];
    return list?.find((x) => x.name === name);
  };
  const pipelines = pipelineSpecs.map((p) => ({
    id: id("pl"),
    name: p.name,
    category: p.cat,
    description: p.desc,
    tags: p.tags,
    steps: p.steps
      .map((s) => {
        const m = findRef(s.kind, s.ref);
        return m ? { kind: s.kind, refId: m.id, enabled: true } : null;
      })
      .filter(Boolean),
    updatedAt: p.updated,
    favorite: !!p.fav,
    valid: p.valid !== false,
    history: [],
  }));

  // ---------- Recent edits ----------
  const recent = [
    { kind: "pipeline",  ref: "Portrait — Default",          at: min(8) },
    { kind: "wildcard",   ref: "Hair Color",                at: min(12) },
    { kind: "fixed",      ref: "Subject Profile",           at: min(33) },
    { kind: "constraint", ref: "Warm Hair × Cool Outfit",   at: hr(1) },
    { kind: "wildcard",   ref: "Lighting Mood",             at: hr(2) },
    { kind: "derivation", ref: "Wet-weather adjustments",   at: hr(3) },
    { kind: "combine",    ref: "Subject Phrase",            at: hr(5) },
  ];
  const findByName = (kind, name) => {
    const list = { wildcard: wildcards, fixed: fixedValues, combine: combines, derivation: derivations, constraint: constraints, pipeline: pipelines }[kind];
    return list.find((x) => x.name === name);
  };
  const recentEdits = recent
    .map((r) => {
      const m = findByName(r.kind, r.ref);
      return m ? { kind: r.kind, id: m.id, name: m.name, at: r.at } : null;
    })
    .filter(Boolean);

  return { categories, wildcards, fixedValues, combines, derivations, constraints, pipelines, recentEdits };
})();

// Helpers
function relTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function classNames(...xs) { return xs.filter(Boolean).join(" "); }

// Module-kind metadata (icons + labels + colors)
const KIND_META = {
  wildcard:   { label: "Wildcard",    icon: "pi-th-large",      color: "#a78bfa", id_prefix: "wc" },
  fixed:      { label: "Fixed Value", icon: "pi-tag",           color: "#22d3ee", id_prefix: "fv" },
  combine:    { label: "Combine",     icon: "pi-share-alt",     color: "#34d399", id_prefix: "cb" },
  derivation: { label: "Derivation",  icon: "pi-code",          color: "#fbbf24", id_prefix: "dv" },
  constraint: { label: "Constraint",  icon: "pi-sitemap",       color: "#f472b6", id_prefix: "cn" },
  pipeline:   { label: "Pipeline",    icon: "pi-list",          color: "#fb7185", id_prefix: "pl" },
};

// ---------- Wildcard syntax helpers ----------
// Returns the list of @ref names referenced from a single value string.
// Skips @@ literal escapes.
function refsInValue(s) {
  if (!s) return [];
  const out = [];
  const re = /(^|[^@])@([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[2]);
  return out;
}
// True if a value string contains a {a|b|c} inline-choice block (with at least one |).
function hasInlineChoice(s) {
  if (!s) return false;
  const re = /\{([^{}]*\|[^{}]*)\}/;
  return re.test(s);
}
// Aggregate flags + ref list for a wildcard module.
function getWildcardSyntax(wc) {
  const refs = new Set();
  let inline = false;
  for (const opt of wc.options || []) {
    refsInValue(opt.value).forEach((r) => refs.add(r));
    if (hasInlineChoice(opt.value)) inline = true;
  }
  return { refs: [...refs], hasNested: refs.size > 0, hasInline: inline };
}
// Build a forward + reverse adjacency over all wildcards by varBinding.
// Forward: wildcardId -> Set<targetVarBinding>
// Reverse: varBinding -> Set<wildcardId> (who references this var)
function buildWildcardGraph(wildcards) {
  const fwd = new Map();
  const rev = new Map();
  const byVar = new Map(wildcards.map((w) => [w.varBinding, w]));
  for (const w of wildcards) {
    const { refs } = getWildcardSyntax(w);
    const targets = new Set(refs.filter((r) => byVar.has(r)));
    fwd.set(w.id, targets);
    for (const t of targets) {
      if (!rev.has(t)) rev.set(t, new Set());
      rev.get(t).add(w.id);
    }
  }
  return { fwd, rev, byVar };
}

// Make a short uuid id for new items.
function makeId(prefix) {
  const sid = Math.random().toString(36).slice(2, 10).padStart(8, "0").slice(-8);
  return `${prefix}_${sid}`;
}

Object.assign(window, { WP_DATA, relTime, classNames, KIND_META, makeId, refsInValue, hasInlineChoice, getWildcardSyntax, buildWildcardGraph });
