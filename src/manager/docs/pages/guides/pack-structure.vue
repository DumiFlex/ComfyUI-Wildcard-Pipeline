<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import GuideTable from "./GuideTable.vue";

interface GuideTable { title: string; note?: string; head: string[]; rows: string[][] }
interface Blueprint {
  title: string;
  intro: string;
  rows: string[][];
  template: string;
  negative?: string;
  notes: string[];
}

const roles = [
  { term: "Decision", desc: "A choice something else reacts to. Make it its own wildcard with a variable, in the Context's stack. Anything a constraint, derivation, Match variable, sweep or other module reads must be one. A pick made only inside an @{} reference sets no variable, so nothing can read it, and a constraint whose source is only rolled inside a reference never applies." },
  { term: "Detail", desc: "Variety nothing reads. Put it in @{} references inside the decision's options, so each option draws its own parts: an Outfit option \"@{Tops:formal} with @{Bottoms:formal}\" next to \"@{Dresses:casual}\". This is a recipe wildcard. Lock the outfit and its parts still vary." },
  { term: "Agreement", desc: "Two picks that must fit together. Use a constraint: a tag matrix for whole families, exceptions for single pairs, an Only rule for allow-lists, and a fallback option on the target so it never comes out empty." },
  { term: "Consequence", desc: "Text that follows from a pick, like a title from a class. Use a derivation. Append and Prepend add exactly what you type, so start the text with its own separator (\", with a scarf\"). Never set a variable a wildcard already sets: the last write wins and the pick is thrown away." },
  { term: "Driver", desc: "A variable that decides things but should not print, like $season. Turn on Hide from prompt for it. Constraints, combines and derivations still read it; the Assembler leaves it out." },
  { term: "Phrase", desc: "A combine joins variables into one phrase: $look = \"wearing $outfit and $shoes\". The usual way to print a driver is through a phrase like this." },
  { term: "Skeleton", desc: "The Assembler template is the prompt's order, written the way your model family wants it. It only fills in $variables: {a|b} prints exactly as typed and @{} prints nothing there." },
  { term: "Constant", desc: "Fixed values hold always-on style and quality tags and standing negatives. They are not for variety: {a|b} in a fixed value has no weights, tags, constraints, fallback or Test Runner counts." },
  { term: "Frames", desc: "Under a WP Context Loop: per-frame overrides for a few named beats, a rule on $iteration for something that runs over all frames, Hold across run for a character that stays the same, and a sweep for side-by-side comparisons (swept picks ignore constraints)." },
  { term: "Model and rating", desc: "WP Model Info's $model_family and $model_variant drive the quality header through derivations or constraints. A $rating driver plus constraints decides how explicit a pack can get. The library's content rating is only a label." },
];

const layers: string[][] = [
  ["0", "Inputs (on the canvas)", "Injector rows, WP Model Info, WP Context Loop", "`$subject`, `$character_lora`, `$model_variant`, `$iteration`", "Loop and Model Info variables start hidden; Injector rows as needed"],
  ["1", "Drivers", "Anchor wildcards, Match variable wildcards (Frame, Model, Rating), Hold where needed", "`$_class`, `$_season`, `$_frame`", "Hidden"],
  ["2", "Subject", "Wildcards, or a derivation \"a LoRA replaces the character\"", "`$character`, `$species`", "Parts hidden, a combine prints them"],
  ["3", "Appearance", "Wildcards with `@{Colors:…}` details; constraints from drivers", "`$hair`, `$eyes`, `$body`", "Printed"],
  ["4", "Outfit", "Recipe wildcard with accepts groups; shoes and accessories as their own wildcards, constrained by it", "`$outfit`, `$shoes`, `$accessories`", "Printed"],
  ["5", "Pose and expression", "One tagged pose list plus a constraint from Frame or class", "`$pose`, `$expression`", "Printed"],
  ["6", "Scene", "Place and time of day; constraints from drivers", "`$place`, `$time_of_day`", "Often hidden, printed through a phrase"],
  ["7", "Light, weather, camera", "Wildcards whose accepts groups agree with the scene", "`$light`, `$weather`, `$camera`", "Printed"],
  ["8", "Style and quality", "Fixed values with negatives; a per-model derivation or Match variable wildcard", "`$style`, `$quality`", "Printed"],
  ["9", "Composition", "Combines that join layers; derivations that edit text (story beats, LoRA swaps, negatives)", "`$look`, `$scene`, `$beat`", "Printed"],
  ["10", "Template", "One Assembler template, plus a negative template with `$negatives`", "", ""],
];

const naming = [
  { term: "Modules", desc: "Pack · Layer · Thing in the library (\"Noir · Outfit · Coats\"). A → B for constraints (\"Frame → Pose\"). A short verb phrase for derivations (\"LoRA replaces character\", \"Story beat\")." },
  { term: "Variables", desc: "Lowercase snake_case, one concept each, singular ($pose, not $poses). Multi-picks plural ($accessories). Drivers start with an underscore ($_frame) and stay hidden. Injector rows can't start with an underscore, so inputs use plain names." },
  { term: "Vocabularies", desc: "A plural noun with no variable (Colors, Fabrics, Flora), used only through references like @{Colors:warm}." },
  { term: "Tags", desc: "Lowercase single words for what rules test, the same word on both sides of a constraint. Classify groups lowercase (season, formality); accepts groups UPPERCASE (SHOES, LIGHT) so $outfit.SHOES reads as an accessor. When no tag fits a new option, add a new tag: never force \"battle axe\" into #sword." },
  { term: "Fallback", desc: "On every constraint target and every Match variable wildcard. Pick the most neutral option." },
];

const jobTables: GuideTable[] = [
  {
    title: "Making a choice",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["A list of alternatives for one concept", "A wildcard with a variable", "A fixed value with `{a|b|c}`; one wildcard per case (`$winter_top`, `$summer_top`)", "One concept per wildcard. Pose, camera and hair in one list can no longer vary or be constrained apart."],
      ["Sometimes nothing (a hat in 30% of runs)", "The null option; its weight is the share of empty runs", "An option with empty text", "A multi-pick never draws the null option: for \"maybe none\" set the use to Pick 0-2."],
      ["Never come out empty", "A fallback option (weight 0 if it should only stand in)", "Hoping the weights cover it", "Option toggles and the category filter run first and can remove the fallback for that use."],
      ["Common and rare options", "Weights (2-3 for common, 0.5 for rare; 0 turns one off without deleting it)", "Typing the same option twice", "If every weight ends up 0, the wildcard gives nothing unless it has a fallback."],
      ["Several at once (2-3 accessories)", "Pick 2-3 on the use, with a separator; read one with `$accessories.0`", "Several wildcards with the same list", "Constraints from a multi-pick source apply once per pick."],
      ["A tiny cosmetic change inside one option", "An inline pick: `{red|crimson} scarf`", "A second wildcard", "Nothing can test an inline pick: it has no tags and no pick record, and Debug shows only the result. `{solo}` with no pipe stays literal."],
      ["Parts that each option chooses for itself", "`@{}` references inside the options (a recipe wildcard)", "Two wildcards and a combine, when nothing reads the parts", "Each reference is a fresh pick and sets no variable."],
      ["One vocabulary used in many places", "A wildcard with no variable (Colors), drawn with `@{Colors:warm}`", "Copying the list into every wildcard", "It must be on the node or in the library of the machine that runs the graph."],
      ["Several picks from a vocabulary", "`{2-3$$, $$@{Props:indoor}}` inside an option", "Separate Props wildcards", "The picks are distinct and constraints on Props still apply."],
      ["A shared workflow that keeps working elsewhere", "Keep the vocabulary as a row on the node (it may be disabled)", "Relying on the other person's library", "A row on the node wins over the library copy, so later library edits don't reach it. WP Debug shows where each pool came from."],
      ["Bring in an existing wildcard collection", "Import / Export → Wildcard packs. Merge files that are variants of one slot (the folder names become tags); keep separate files that are different slots", "Pasting lists by hand", "Importing the same pack again updates it instead of adding copies."],
    ],
  },
  {
    title: "Narrowing and making picks agree",
    note: "Inside one roll the order is: filter and toggles, then weights, then constraints, then the fallback. So pick the first tool that says what you mean, and give any pool that can be emptied a fallback.",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["One pick to change another's odds", "A constraint", "A derivation that rewrites the target", "\"Rarely, never, only, more often\" is a constraint. \"Add, say, replace\" is a derivation."],
      ["A whole family of rules (winter rules out summer clothes)", "The constraint's tag matrix", "One exception per option", "Use the same tag words on both wildcards."],
      ["One special pair", "A constraint exception", "A new tag for one option", "Exceptions are keyed by option text: renaming the option orphans the rule."],
      ["An allow-list (the fight beat allows only fight poses)", "An Only rule", "Excluding everything else by hand", "Options the row doesn't mention drop out, so give the target a fallback."],
      ["Two picks that agree on one attribute, and you print it", "An accepts group on the source (SHOES) plus a constraint with a diagonal Only (sneakers → sneakers, boots → boots); print `$outfit.SHOES`", "Classify tags: they allow sneakers and boots together", "The accepted tag is rolled evenly, not by weight. Every option needs at least one tag in the group."],
      ["A fixed narrowing for one use", "The category filter on the use, or `@{X:tag}` in text", "A constraint", "A filter can't read a variable."],
      ["Hand-picked options for one use", "Option toggles: tick only the ones you want", "Deleting options", "Even one ticked option still obeys constraints and can come out empty. Keep an enabled fallback."],
      ["Softer odds without forbidding", "Per-use weights", "Exclude", "Per-use changes don't show in the library editor."],
      ["A variable decides the pick (`$iteration`, `$model_variant`, an Injector value)", "Match variable on a wildcard whose options spell those values; it then works as a constraint source", "A 20-branch derivation", "It compares the option's raw text (case and outer spaces ignored), so options with `{a|b}` or `@{}` never match. It skips filters, toggles and constraints. Give it a fallback."],
      ["A many-to-one mapping, or text, from a variable", "A derivation", "Match variable", "A derivation's result is text, not a pick."],
      ["Only the first or next N copies of a target", "The constraint's Target reach", "Copying the constraint", "Reach counts down the stack from the constraint."],
      ["To check the odds", "The constraint's Preview card, then the Test Runner", "Guessing", "Preview leaves out other constraints, filters and toggles."],
    ],
  },
  {
    title: "Text that follows, and constants",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["Text that depends on picks (if winter, add a scarf)", "A derivation", "A constraint", "Append and Prepend need a separator in the text."],
      ["A pick only in some cases", "A derivation action holding `@{Accessories:winter}`", "A wildcard that is mostly the null option", "That pick sets no variable."],
      ["Another source replaces a pick (a LoRA replaces the rolled character)", "A derivation: IF `$character_lora` is set, Replace `$character`", "", "The one good reason to overwrite a wildcard's variable."],
      ["A lookup from one pick to another (mage → robe, 20 times)", "A constraint on a tagged list", "20 equals → Replace branches", "Story text keyed on `$iteration` is the exception: there is no pick to constrain from."],
      ["Several picks joined into one phrase", "A combine", "Retyping it in each template", "A combine drops `@{}`. Use it for phrases, not picks."],
      ["A tag group printed as text", "A combine: `wearing $outfit with $outfit.SHOES`", "", "Only accepts groups can be read. `$outfit.STYLE` on a classify group renders nothing."],
      ["Always-on text (quality, style preset)", "Fixed values", "A one-option wildcard", "Never a wildcard for the same variable as well: the later one wins without a word."],
      ["A prompt skeleton you reuse", "The Templates library (Save and Load on the Assembler)", "Fixed values", "A template holds no variables and rolls nothing."],
      ["Negative words an option invites (\"strawberry blonde\" invites fruit)", "The option's negative", "The standing negative", "Reaches only an Assembler that rendered that variable, and only matters at CFG above 1."],
      ["A standing negative (lowres, watermark)", "The Assembler's negative template, with `$negatives` where the collected words go", "A negative on every option", ""],
      ["Text from outside the stack (a typed subject, an LLM's caption)", "WP Context Injector", "A wildcard", "Injected values are not picks. To make one a constraint source, match it with a wildcard."],
      ["Outside text plus a light template on the canvas", "Injector template rows", "A combine", "Use a combine for reusable library logic that rolls."],
    ],
  },
  {
    title: "Holding, hiding and frames",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["A driver that should not print", "Hide from prompt", "Just leaving it out of the template", "A later write without Hide from prompt makes it print again. In a template it renders nothing and warns \"unknown variable\"."],
      ["The same pick for a whole Loop run", "Hold across run", "Lock pick", "A held derivation still checks its conditions every frame; only the {a|b} and @{} rolls in each branch are frozen."],
      ["The same pick every time you press Generate", "Lock pick (Lock seed on other modules)", "Hold across run", "Frozen across every run and every frame."],
      ["No roll at all", "Fixed values", "A locked wildcard", ""],
      ["Options compared side by side", "Sweep combinations on the Loop (64 frames by default, up to 999)", "Queueing runs by hand", "Swept wildcards are pinned, so constraints don't re-weight them: a sweep can show pairs the pack forbids. Hold other picks keeps everything else still."],
      ["A few frames that differ, on the canvas", "Per-frame overrides (the edit frame chips)", "Pack logic", "Canvas only: not saved in bundles and not run by the Test Runner."],
      ["A rule over all frames that ships in a pack", "A Frame wildcard matching `$iteration` plus a constraint, or a derivation on `$iteration`", "One wildcard per frame", "Test it by pinning iteration in the Test Runner."],
      ["One module on or off for some frames", "Per-frame enable", "Bypassing the frame", "Works both ways: on everywhere but some frames, or only on some."],
      ["Whole frames skipped", "Frame bypass (Ctrl-click a frame chip)", "Turning every module off", "Kept frames keep their numbers."],
      ["Keeper frames you can reproduce", "Override seed plus per-iteration seed locks on the Loop", "Locks without Override seed (they are ignored)", "WP Image Filter's Send to Loop writes both for you."],
      ["A different sampler seed per frame", "WP Seed List", "Changing the Loop seed", "Seed List only feeds the sampler. It never changes a prompt."],
      ["Seeds you can read out", "The Sequential strategy", "", "The strategy doesn't make results more or less varied."],
    ],
  },
  {
    title: "Nodes around the stack",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["Different wording per checkpoint", "WP Model Info plus a derivation, or a Match variable wildcard", "An Injector", "Pin the variant when detection gets a checkpoint wrong."],
      ["A pick that drives a number or switch (`$steps`, `$cfg`, a LoRA strength)", "WP Var → Int / Float / Bool reading a hidden variable", "A number in the prompt", "A derivation can write the hidden `$cfg` that the Var node reads."],
      ["A human choice before an expensive pass", "WP Image Filter (pause)", "Running it unattended", "The queue waits. Unattended, use pass all, or a timeout set to keep all."],
      ["Duplicates removed, weights merged, LoRA tags spaced, words blocked", "WP Prompt Cleaner after the Assembler", "The Assembler's tidy", "The tidy only closes gaps left by empty variables. It never dedupes and leaves verbs (\"a girl wearing, sitting\")."],
      ["Clean prose prompts", "The Cleaner in text mode, Gentle", "Tags mode", "Tags mode splits sentences."],
      ["Words kept out for safety", "Constraints at the source, then negatives, then a Cleaner blocklist", "Any one of them alone", "The blocklist matches whole words: list every variant, or use a regex."],
      ["Why one run came out like that", "WP Debug", "The Test Runner", ""],
      ["How often each option shows, and what an edit changed", "The Test Runner (many seeds; baselines to compare)", "WP Debug", "It runs frame 0 only. Pin `$iteration` to test a frame."],
    ],
  },
  {
    title: "Organising and sharing",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["A set of modules you reuse", "A bundle, with sub-bundles for its sections", "", "A bundle groups modules. It does not keep their variables apart."],
      ["Two copies of one character", "The bundle inserted twice, with the second copy's variables renamed", "Two loose copies of one wildcard", "A constraint inside each copy reads its own copy's source pick."],
      ["The same module again under a new variable", "A second use with its own Variable binding", "A fork", ""],
      ["A canvas copy with its own variable", "Duplicate (`$hair` becomes `$hair_2`)", "", ""],
      ["A library copy that will go its own way", "Fork (\"(copy)\")", "Editing the shared one", ""],
      ["Canvas edits sent to the library", "Push to library", "", "Library bundles that hold the module are updated too. Canvas copies elsewhere show drift."],
      ["A newer library version pulled in", "Refresh from library (a row) or Reset to library snapshot (a bundle)", "", ""],
      ["Bundle children as stand-alone library modules", "Extract to library, in the bundle editor", "", "It makes new ids (a fork) and leaves per-use overrides behind."],
      ["To try a pack without something", "Disable it", "Delete it", "Delete through the manager: it fixes every reference in one step you can undo."],
      ["A safe / nsfw label for lists and publishing", "Content rating", "Expecting it to filter anything", "It has no effect on a run. Use a `$rating` driver."],
      ["Many options pasted at once", "Bulk add: `value #tag *N -- negative`, one per line", "", ""],
      ["Many options changed at once", "The selection toolbar (tag, weight, delete)", "", ""],
    ],
  },
  {
    title: "Getting AI help",
    head: ["You want", "Use", "Not", "Watch out"],
    rows: [
      ["Help with the item you have open", "That editor's Draft with AI panels", "The chat", ""],
      ["Answers, edits across the library, test runs", "The chat", "", "Every change is a card you apply."],
      ["A new pack of 5 to 60 items, or a bundle extended", "The Pack builder", "The chat", ""],
    ],
  },
];

const syntaxHead = ["Field", "$var", "$var.K, .AXIS, .neg", "@{ref}", "{a|b}, {N$$sep$$…}", "Notes"];
const syntaxRows: string[][] = [
  ["Wildcard option", "no (stays as text)", "no", "yes", "yes", "Weights like `(tag:1.2)` pass through as text."],
  ["Option negative", "no", "no", "yes (no pick recorded)", "yes", "Rolls on its own stream, so it never moves a pick."],
  ["Fixed value and its negative", "no", "no", "no", "yes", "No weights, tags or constraints on the inline pick."],
  ["Combine template and its negative", "yes", "yes", "dropped", "yes", ""],
  ["Derivation condition", "names the variable it tests", "yes", "no", "no", "The value it compares to is plain text."],
  ["Derivation action (all modes)", "yes", "yes", "yes", "yes", "A fresh pick each time the branch fires."],
  ["Category filter, `:filter`", "no", "no", "no", "no", "Tag names with and, or, not and parentheses."],
  ["Assembler template", "yes", "yes", "dropped", "printed as typed", "No seed. Hidden variables render nothing."],
  ["Assembler negative template", "yes (its text only)", "yes", "dropped", "printed as typed", "`$negatives` marks where the collected words go."],
];

const blueprintHead = ["#", "Module", "Kind", "Writes", "Options and settings"];
const blueprints: Blueprint[] = [
  {
    title: "Blueprint: character",
    intro: "A fantasy adventurer for a tag model. The class is a hidden driver that steers the expression and prints through a phrase, so a LoRA can replace the whole subject.",
    rows: [
      ["Library", "Colors", "Vocabulary", "", "Tags natural, vivid, dark, metal"],
      ["1", "Class", "Wildcard", "`$_class`", "knight, ranger, mage, rogue, cleric; tags martial, caster, stealth. Hide from prompt, Hold across run"],
      ["2", "Species", "Wildcard", "`$species`", "human (3), elf, dwarf, halfling (1 each)"],
      ["3", "Character", "Combine", "`$character`", "`$species $_class`"],
      ["4", "LoRA replaces character", "Derivation", "`$character`", "IF `$character_lora` is set → Replace `$character_lora`"],
      ["5", "Hair", "Wildcard", "`$hair`", "`long @{Colors:natural} hair`, `short @{Colors:natural} hair, undercut`, …"],
      ["6", "Eyes", "Wildcard", "`$eyes`", "`@{Colors:vivid} eyes`, `heterochromia`, …"],
      ["7", "Class → Expression", "Constraint", "", "caster → serene boost 2; stealth → smirk boost 2"],
      ["8", "Expression", "Wildcard", "`$expression`", "determined, smirk, serene, …; null option weight 3"],
      ["9", "Style", "Fixed values", "`$style`, `$quality`", "`fantasy illustration, painterly` (negative `photo, 3d render`); your model's quality tags"],
    ],
    template: "$quality, $character, $hair, $eyes, $expression, $style",
    negative: "lowres, bad hands, watermark, $negatives",
    notes: [
      "$_class is a decision (a constraint reads it), so it is a chain wildcard. Its text reaches the prompt only through $character.",
      "Hair and eyes draw colours from one vocabulary as fresh picks: they don't need to match. If they should, make $color a wildcard and read it in a combine.",
      "$character_lora comes from an optional Injector row. With no LoRA wired, the derivation does nothing.",
    ],
  },
  {
    title: "Blueprint: outfit and shoes (accepts)",
    intro: "A wardrobe where each outfit offers the shoes it goes with, the shoes always agree, and the season rules out the wrong clothes.",
    rows: [
      ["Library", "Colors, Fabrics, Patterns", "Vocabularies", "", "Colors: neutral, warm, cool, dark, metal. Fabrics: casual, formal, winter, summer. Patterns: subtle, bold, null weight 2"],
      ["1", "Season", "Wildcard", "`$_season`", "winter, summer (tagged the same). Hide from prompt"],
      ["2", "Season → Outfit", "Constraint", "", "winter → summer exclude; summer → winter reduce 0.2"],
      ["3", "Outfit", "Wildcard", "`$outfit`", "`@{Colors:neutral or dark} @{Fabrics:formal} suit` [formal, winter, summer; SHOES loafers, boots]; `@{Patterns} @{Fabrics:summer} sundress` [casual, summer; SHOES sandals, sneakers]; `@{Colors} hoodie and @{Colors:dark} jeans` [casual, winter, summer; SHOES sneakers] fallback. Groups: style and season classify, SHOES accepts"],
      ["4", "Outfit → Shoes", "Constraint", "", "Only on the diagonal: loafers → loafers, boots → boots, sandals → sandals, sneakers → sneakers"],
      ["5", "Shoes", "Wildcard", "`$shoes`", "black loafers [loafers], ankle boots [boots], leather sandals [sandals], white sneakers [sneakers] fallback"],
      ["6", "Outfit → Accessories", "Constraint", "", "formal → casual reduce 0.3"],
      ["7", "Accessories", "Wildcard", "`$accessories`", "`a @{Colors:metal} watch`, `a silk scarf`, …; Pick 0-2, separator `, `"],
      ["8", "Look", "Combine", "`$look`", "`wearing $outfit and $shoes, $accessories`"],
    ],
    template: "$subject, $look, $style",
    notes: [
      "Colours, fabrics and patterns are details: each outfit chooses its own and nothing reads them. Shoes and accessories are decisions because constraints act on them.",
      "If the rolled accepted tag is all you need, skip the Shoes wildcard and write `wearing $outfit with $outfit.SHOES`.",
      "Don't print $outfit.style: style is a classify group, and classify groups render nothing.",
    ],
  },
  {
    title: "Blueprint: two characters from the same wildcards",
    intro: "Two people built from one character bundle, without one overwriting the other.",
    rows: [
      ["1", "Character bundle, copy A", "Bundle", "`$character`, `$hair`, `$eyes`, `$outfit`", "As built"],
      ["2", "Character bundle, copy B", "Bundle", "`$character_b`, `$hair_b`, `$eyes_b`, `$outfit_b`", "Inserted again; each child's Variable binding renamed"],
      ["3", "Person A", "Combine", "`$char_a`", "`$character, $hair, $eyes, $outfit`"],
      ["4", "Person B", "Combine", "`$char_b`", "`$character_b, $hair_b, $eyes_b, $outfit_b`"],
      ["5", "Place, light, camera, style", "Wildcards and fixed values", "`$place`, `$light`, `$camera`, `$style`", "Shared, once"],
    ],
    template: "$quality, 2girls, $char_a, $char_b, $place, $light, $camera, $style",
    notes: [
      "Rename the second copy's variables. Two copies writing $hair just overwrite each other (last write wins). Duplicate on the canvas does this for you ($hair_2).",
      "Use two bundle copies, not two loose rows of one wildcard: a constraint inside each copy reads the source pick of its own copy.",
      "Attributes bleed between people. On tag models give them clearly different traits and a count tag. On prose models write \"On the left, $char_a. On the right, $char_b.\" For the strongest split, use one Assembler per region (regional prompting) reading the same Context.",
    ],
  },
  {
    title: "Blueprint: landscape",
    intro: "Wild places where the biome and season decide the weather, and the light agrees with the weather. The drivers print only through one phrase.",
    rows: [
      ["Library", "Flora", "Vocabulary", "", "Tags cold, temperate, arid, tropical (pine, birch, saguaro, palms, …)"],
      ["1", "Biome", "Wildcard", "`$_biome`", "`boreal forest of @{Flora:cold}` [cold]; `red desert canyon with @{Flora:arid}` [arid]; `misty jungle valley, @{Flora:tropical}` [tropical]; `alpine meadow` [cold, temperate]. Hidden"],
      ["2", "Biome → Season", "Constraint", "", "tropical: Only wet season and dry season; arid → wet season reduce 0.2"],
      ["3", "Season", "Wildcard", "`$_season`", "winter, spring, summer, autumn, wet season, dry season. Hidden"],
      ["4", "Season → Weather", "Constraint", "", "summer → snow exclude; winter → snow boost 3"],
      ["5", "Biome → Weather", "Constraint", "", "arid → fog reduce 0.2; arid → snow exclude"],
      ["6", "Weather", "Wildcard", "`$weather`", "heavy snowfall [snow; LIGHT overcast, dusk]; clear blue sky [clear; LIGHT noon, golden]; morning fog [fog; LIGHT dawn, overcast]; thunderstorm [storm; LIGHT overcast, night]. LIGHT is an accepts group. Option negatives: clear → `clouds`, snow → `green grass`"],
      ["7", "Weather → Light", "Constraint", "", "Diagonal Only on LIGHT"],
      ["8", "Light", "Wildcard", "`$light`", "soft dawn light [dawn], harsh noon sun [noon], golden hour glow [golden], … fallback `soft overcast light`"],
      ["9", "Camera", "Wildcard", "`$camera`", "wide establishing shot, low angle, aerial view, …"],
      ["10", "Scene", "Combine", "`$scene`", "`$_biome in $_season, $weather, $light`"],
      ["11", "Style", "Fixed values", "`$style`", "`landscape photography, 35mm` (negative `people, text`)"],
    ],
    template: "$scene, $camera, $style",
    negative: "$negatives, lowres, oversaturated",
    notes: [
      "Two constraints on Weather multiply. An exclude in either one wins.",
      "Option negatives follow usage: \"clouds\" reaches the negative only when the sky is clear.",
      "On anime tag models add `no humans, scenery`, or the model adds a person.",
    ],
  },
  {
    title: "Blueprint: story over a Loop",
    intro: "Six frames of one story. The cast stays the same, while place, pose and camera follow each frame's beat, and the whole thing ships in a pack.",
    rows: [
      ["Canvas", "WP Context Loop, count 6", "Node", "`$iteration` = 1 to 6", "Feeds the Context that holds the bundles below"],
      ["1", "Character and Wardrobe bundles", "Bundles", "`$character`, `$look`", "Every use: Hold across run"],
      ["2", "Frame", "Wildcard", "`$_frame`", "\"1\" [arrive], \"2\" [search], \"3\" [search], \"4\" [fight], \"5\" [fall], \"6\" [rest] fallback. Match variable `iteration`, hidden"],
      ["3", "Frame → Place", "Constraint", "", "One Only cell per beat: arrive → arrive, search → search, …"],
      ["4", "Place", "Wildcard", "`$place`", "train station [arrive], old library [search], rooftops [fight, fall], inn [rest], …"],
      ["5", "Frame → Pose", "Constraint", "", "One Only cell per beat"],
      ["6", "Pose", "Wildcard", "`$pose`", "About 30 poses, each tagged with every beat it suits"],
      ["7", "Frame → Camera", "Constraint", "", "arrive → establish boost 3; fight → action boost 3; rest → emotion boost 2"],
      ["8", "Pose → Camera", "Constraint", "", "lying → from above boost 2"],
      ["9", "Camera", "Wildcard", "`$camera`", "wide shot [establish], close-up [emotion], dutch angle [action], …"],
      ["10", "Story beat", "Derivation", "`$beat`", "IF `$iteration` equals \"1\" → \"stepping off the night train\"; ELIF matches `^[2-3]$` → \"searching dusty shelves for the letter\"; … ELSE \"asleep by the fire, letter in hand\""],
    ],
    template: "$character, $look, $pose, $beat, $place, $camera, $style",
    notes: [
      "One Pose list plus a Frame wildcard and an Only constraint beats one pose wildcard per frame: $pose stays random inside its beat, is a real pick that can drive Pose → Camera, and a new frame is one option plus one cell.",
      "$iteration is text (\"1\" to \"6\"). Ranges are a matches test like ^[3-4]$. Frames past 6 take the fallback.",
      "Test each frame in the Test Runner by pinning iteration. Hold and per-frame overrides only show on the canvas.",
      "Per-frame overrides (the edit frame chips) are fine for a one-off tweak, but they live in the workflow and don't travel with the pack.",
    ],
  },
  {
    title: "Blueprint: sweep comparison",
    intro: "A contact sheet of every style against every light, with the rest of the prompt held still.",
    rows: [
      ["Canvas", "WP Context Loop", "Node", "", "Sweep combinations on: Style (4 options) × Light (3) = 12 frames. Hold other picks on. Keep the KSampler on one fixed seed"],
      ["1", "Subject", "Wildcard", "`$subject`", "Held by Hold other picks"],
      ["2", "Style", "Wildcard", "`$style`", "Swept (the first wildcard changes slowest, so it gives the rows)"],
      ["3", "Light", "Wildcard", "`$light`", "Swept (the columns)"],
      ["4", "Quality", "Fixed values", "`$quality`", ""],
    ],
    template: "$quality, $subject, $light, $style",
    notes: [
      "Swept wildcards are pinned, so constraints don't re-weight them. Don't sweep a constraint target expecting the pack's rules: you will see pairs the pack forbids.",
      "Turn Hold other picks off when the rest should vary too.",
      "WP Image Filter lays a sweep out as a grid, and Send to Loop keeps the frames you pick.",
    ],
  },
  {
    title: "Blueprint: seasonal pack",
    intro: "One hidden season decides clothes, colours, extras and weather, and prints only inside a phrase.",
    rows: [
      ["Library", "Colors, Accessories", "Vocabularies", "", "Tagged spring, summer, autumn, winter"],
      ["1", "Season", "Wildcard", "`$season`", "spring, summer, autumn, winter (tagged the same). Hide from prompt"],
      ["2", "Season → Colors", "Constraint", "", "Matrix: each season boosts its colours. It reaches `@{Colors}` inside the outfits too"],
      ["3", "Season → Outfit", "Constraint", "", "Only by season"],
      ["4", "Outfit", "Wildcard", "`$outfit`", "`@{Colors} wool coat` [autumn, winter], `@{Colors} linen dress` [spring, summer], … fallback"],
      ["5", "Seasonal extras", "Derivation", "`$outfit`", "IF `$season` equals winter → Append `, @{Accessories:winter}`; IF summer → Append `, @{Accessories:summer}`"],
      ["6", "Season → Weather", "Constraint", "", "Only by season"],
      ["7", "Weather", "Wildcard", "`$weather`", "light snow [winter], spring rain [spring], … fallback"],
      ["8", "Place", "Wildcard", "`$place`", ""],
      ["9", "Scene", "Combine", "`$scene`", "`$place in $season, $weather`"],
    ],
    template: "$subject, $outfit, $scene, $style",
    notes: [
      "The extras are a conditional draw: the derivation adds a fresh accessory only in winter or summer. Its pick sets no variable, which is fine because nothing reads it.",
      "The Append text starts with \", \". Without it the words run together.",
      "For a fixed season on one node, untick the other options on the Season use instead of deleting them.",
    ],
  },
  {
    title: "Blueprint: photography",
    intro: "Portrait photos where the framing chooses a fitting lens, written as prose for Flux-style models or as short phrases for realistic SDXL models.",
    rows: [
      ["1", "Shot", "Wildcard", "`$shot`", "close-up portrait [close], head and shoulders [close], half-body [mid], full-length [wide]"],
      ["2", "Shot → Lens", "Constraint", "", "close → 85mm boost 3; wide → 35mm boost 2"],
      ["3", "Lens", "Wildcard", "`$lens`", "`85mm lens, f/1.8, shallow depth of field` [85mm]; `50mm lens, natural perspective` [50mm]; `35mm lens, environmental portrait` [35mm]"],
      ["4", "Subject", "Wildcard or Injector", "`$subject`", "Adults with an age: `a woman in her 30s with freckles and short auburn hair`, …"],
      ["5", "Shot → Outfit", "Constraint", "", "close → options tagged footwear exclude"],
      ["6", "Outfit", "Wildcard", "`$outfit`", "One coherent outfit per option"],
      ["7", "Light", "Wildcard", "`$light`", "Rembrandt lighting, butterfly lighting, soft window light from the side, rim light"],
      ["8", "Film", "Wildcard", "`$film`", "Kodak Portra 400, Ilford HP5 black and white (negative `vivid colors`), …"],
      ["9", "Texture", "Fixed values", "`$texture`", "`visible skin texture, natural makeup`"],
      ["10", "Photo", "Combine", "`$photo`", "`$shot of $subject wearing $outfit, $light, $lens, shot on $film`"],
    ],
    template: "$photo. $texture.",
    negative: "lowres, blurry, watermark, plastic skin, $negatives",
    notes: [
      "Name the light setup and the lens instead of \"beautiful, perfect, 8k\": that is what moves a photo prompt.",
      "Shoes in a close-up waste words and leak colour, so the shot rules them out.",
      "On Flux the negative does nothing (CFG 1). See Writing prompts for your model.",
    ],
  },
  {
    title: "Blueprint: product shot",
    intro: "A product typed on the canvas, shot in a few setups with matching light.",
    rows: [
      ["Canvas", "WP Context Injector", "Node", "`$product`, `$label`", "`a ceramic pour-over coffee dripper`; label text, short"],
      ["1", "Setup", "Wildcard", "`$setup`", "`hero shot on a seamless backdrop` [studio]; `flat lay from overhead` [flat]; `on a marble counter by a window` [lifestyle]"],
      ["2", "Setup → Light", "Constraint", "", "studio → softbox boost 3; lifestyle: Only window"],
      ["3", "Light", "Wildcard", "`$light`", "`studio softbox lighting with a rim light` [softbox] fallback; `soft natural window light from the side` [window]; `hard light with long shadows` [hard]"],
      ["4", "Surface", "Wildcard", "`$surface`", "reflection on black acrylic, on travertine, on washed linen"],
      ["5", "Lens", "Wildcard", "`$lens`", "macro detail, 50mm at eye level, 45-degree angle"],
      ["6", "Shot", "Combine", "`$shot`", "`$product, $setup, $surface, $light, $lens`"],
    ],
    template: "Product photograph. $shot. The label reads \"$label\".",
    negative: "text, watermark, people, $negatives",
    notes: [
      "Quote the label and keep it short. Only text-capable models (Flux, Qwen-Image, Z-Image) spell it well.",
      "Keep brand names and trademarks out of the options.",
    ],
  },
  {
    title: "Blueprint: rating-aware pack",
    intro: "One pack that can render safe or suggestive images, with the register decided once and every slot following it.",
    rows: [
      ["1", "Rating", "Wildcard", "`$_rating`", "safe (fallback), suggestive. Hidden. Untick the options a node shouldn't use"],
      ["2", "Rating tag", "Derivation", "`$rating_tag`", "IF `$_rating` equals safe → `rating_safe` (Pony) or `safe` (NoobAI, Anima); ELSE → `rating_questionable` or `sensitive`"],
      ["3", "Rating → Outfit", "Constraint", "", "safe: Only options tagged safe"],
      ["4", "Outfit", "Wildcard", "`$outfit`", "Tagged safe or suggestive"],
      ["5", "Rating → Pose", "Constraint", "", "safe: Only options tagged safe"],
      ["6", "Pose", "Wildcard", "`$pose`", "Tagged the same way"],
      ["7", "Safe guard", "Derivation", "`$rating_tag`", "IF `$_rating` equals safe → Add to negative `nsfw, nude, rating_explicit`"],
    ],
    template: "$quality, $rating_tag, $subject, $outfit, $pose, $style",
    notes: [
      "The rating tag comes from the same driver as the slots, so they never disagree.",
      "The library's content rating (safe / nsfw) is a label for lists and publishing. It changes nothing in a run.",
      "On CFG 1 models the negative is ignored, so the constraints and positive wording have to do the work.",
      "A pack that can reach explicit content must follow Adult (NSFW) packs, safeguards included.",
    ],
  },
  {
    title: "Blueprint: model-retargeting header",
    intro: "One pack that writes the right quality and negative tags for whichever checkpoint is loaded.",
    rows: [
      ["Canvas", "WP Model Info", "Node", "`$model_family`, `$model_variant`", "First in the chain, its model input from the checkpoint loader"],
      ["1", "Quality header", "Derivation", "`$quality`", "IF `$model_variant` equals pony → `score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up`, and Add to negative `score_4, score_5, score_6`. ELIF noobai → `masterpiece, best quality, newest, absurdres, highres`, negative `worst quality, old, early, low quality, lowres`. ELIF illustrious → `masterpiece, best quality, absurdres`, negative `worst quality, low quality, bad anatomy`. ELIF `$model_family` equals flux → nothing. ELSE `high quality`"],
      ["2", "Model", "Wildcard", "`$_model`", "pony, illustrious, noobai, other (fallback). Match variable `model_variant`, hidden"],
      ["3", "Model → Style", "Constraint", "", "pony → photo styles exclude, …"],
      ["4", "Style", "Wildcard", "`$style`", "Tagged by what each model handles"],
    ],
    template: "$quality, $subject, $outfit, $pose, $style",
    negative: "$negatives, watermark",
    notes: [
      "The header's negatives ride on $quality, so they reach the negative output only when the template renders $quality.",
      "Equals is exact and case-sensitive; Match variable ignores case. The shipped variant names are lowercase.",
      "Model Info reads Flux.2 as flux, and newer models (Anima, Z-Image and others) may read under another family name. Pin the variant, or add a variant rule for the file name.",
      "Tag models and prose models want different skeletons. Keep one template per family in the Templates library.",
    ],
  },
  {
    title: "Blueprint: recipe wildcards",
    intro: "The pattern behind most of the blueprints above: a decision whose options are recipes built from vocabularies.",
    rows: [
      ["Library", "Tops, Bottoms, Dresses, Colors, Props, Accessories", "Vocabularies", "", "Tagged by style (casual, formal), season, place (indoor, outdoor)"],
      ["1", "Outfit", "Wildcard", "`$outfit`", "`@{Colors:neutral} @{Tops:formal} with @{Bottoms:formal}` [formal]; `@{Dresses:casual}` [casual]; `@{Tops:casual} and @{Bottoms:casual}` [casual] fallback"],
      ["2", "Props", "Wildcard", "`$props`", "`{2-3$$, $$@{Props:indoor}}` [indoor]; `{1-2$$, $$@{Props:outdoor}}` [outdoor]"],
      ["3", "Winter extras", "Derivation", "`$outfit`", "IF `$season` equals winter → Append `, @{Accessories:winter}`"],
    ],
    template: "$subject, $outfit, $props",
    notes: [
      "Lock the recipe (or tick only one option) and its parts still vary, because each reference is a fresh pick.",
      "The parts set no variables, so nothing can read or test them. The moment something must (a constraint source, a derivation test, a second template), promote that part to its own wildcard.",
      "Constraints still reach the parts: a Season → Tops constraint shapes the @{Tops} inside every outfit. For a narrowing that never changes, a filtered reference like @{Tops:formal} does the same job without a constraint.",
      "$var means the same value everywhere. @{ref} is a new pick every time. Write $color twice to match; write @{Colors} twice for two colours.",
    ],
  },
];

const antiPatterns: string[] = [
  "Reading a pick made inside a reference. A derivation testing $color can't see the colour inside \"@{Colors} dress\". Make it its own wildcard.",
  "A constraint whose source only appears inside a reference. It never applies, and WP Debug warns unknown_constraint_source.",
  "Expecting two references to match. \"@{Colors} jacket and @{Colors} jeans\" match only by chance.",
  "@{} or {a|b} in the Assembler template. The reference prints nothing and the inline pick prints as typed.",
  "A fixed value and a wildcard writing the same variable. Whichever runs later wins without a word.",
  "{watercolor|oil painting} in a fixed value for real variety. That choice has no weights, tags, constraints, fallback or counts. Make it a wildcard.",
  "A derivation that Replaces a variable a constrained wildcard sets (\"if mage, weapon = staff\" next to a Class → Weapon constraint). The constrained pick is thrown away. Use the constraint, with Only if needed.",
  "One wildcard per case: $winter_top and $summer_top, or pose_1 to pose_6 for six frames. Use one tagged list and a constraint.",
  "A lookup derivation with many equals → Replace branches. That is a constraint on a tagged list (story text on $iteration is the exception).",
  "Printing a classify group. $outfit.STYLE renders nothing; only accepts groups can be read.",
  "Forcing an option into the wrong tag. Add a new tag instead.",
  "A hidden variable in the template, expected to print. Print it through a combine.",
  "Append or Prepend text without a separator.",
  "Two characters writing the same variable names. Rename the second copy's variables.",
  "Match variable on options that hold {a|b} or @{}. They never match.",
  "Expecting a sweep to follow the pack's constraints. Swept picks ignore them.",
  "Per-frame overrides in a pack you share. They stay in your workflow.",
  "Loop seed locks without Override seed. They are ignored.",
  "Another family's tags: Pony score tags on Illustrious, or made-up ones like score_9.5. See Writing prompts for your model.",
  "Relying on negatives on a CFG 1 model, or on the content rating to filter anything.",
];
</script>

<template>
  <DocPage
    group="Guides"
    title="Recommended pack structure"
    icon="pi pi-th-large"
    tone="neutral"
    blurb="Plan a pack, pick the right feature for each job, and copy a blueprint."
  >
    <DocSection title="Plan your first pack">
      <ol>
        <li><b>Write one prompt you like</b> by hand, such as "a woman with red hair in a raincoat,
          rainy street at night, film photo".</li>
        <li><b>Mark what should change.</b> Hair colour, outfit, place, time of day: each becomes a
          wildcard. What stays (film photo) becomes a fixed value.</li>
        <li><b>Mark what must fit together.</b> A raincoat goes with rain, not a beach. That's a
          constraint, or a derivation when it only adds words.</li>
        <li><b>Write the template</b> with the variables in place:
          <VarToken>a woman with $hair hair in $outfit, $place, $style</VarToken>.</li>
        <li><b>Test it</b> in the Test Runner over a few hundred seeds and fix what looks wrong.
          Then save the modules as a bundle.</li>
      </ol>
      <p>The rest of this page is the longer version, with blueprints to copy.</p>
    </DocSection>

    <DocSection title="The idea in one minute">
      <p>
        A pack works best when each feature does one kind of job. Sort every part of your prompt
        into one of these roles and the right module follows from the role:
      </p>
      <DocKeyList :items="roles" />
      <DocCallout variant="tip">
        Two rules explain most surprises. <VarToken>$var</VarToken> is the same value everywhere
        you read it. An <VarToken kind="ref">@{ref}</VarToken> is a fresh, independent pick every
        time it appears. So "$color jacket and $color jeans" always match, and "@{Colors} jacket
        and @{Colors} jeans" match only by chance.
      </DocCallout>
    </DocSection>

    <DocSection title="How a stack runs">
      <ul>
        <li>
          <b>Top to bottom, once, last write wins.</b> A later module that writes the same
          variable replaces the earlier value without a warning (WP Debug's trace marks it). A
          chained Context adds to the one above and overrides it.
        </li>
        <li>
          <b>Only a chain wildcard makes a pick.</b> Its pick is recorded, so it can be a
          constraint source, be read with <VarToken>$var.AXIS</VarToken>, be counted per wildcard
          by the Test Runner and be swept. Text from a reference, an inline pick, a fixed value, a
          combine or a derivation is just text.
        </li>
        <li>
          <b>Constraints sit between their source and their target:</b> source, then constraint,
          then target. A target used only inside references is reached too.
        </li>
        <li>
          <b>Each text field reads its own part of the syntax.</b> See the grid below.
        </li>
        <li>
          <b>What crosses a socket:</b> variables (hidden ones too), picks, tag groups,
          constraints, negatives and loop details, so chained Contexts keep working together.
          Reference pools come from the node's own rows first, then from the library on the
          machine that runs the graph.
        </li>
      </ul>
    </DocSection>

    <DocSection title="Layers in running order">
      <p>
        Most packs fall into these layers. Put each in its own sub-bundle, in this order:
      </p>
      <GuideTable :head="['#', 'Layer', 'Typical modules', 'Variables', 'Printed?']" :rows="layers" />
      <p>
        The engine sets three ordering rules: a constraint after its source and before its target,
        a derivation after what it reads, and a combine after its parts. Vocabularies are not in
        the stack at all: they live in the library (or as a row on the node) and are reached
        through references.
      </p>
      <DocKeyList :items="naming" />
    </DocSection>

    <DocSection title="Which feature for which job">
      <p>
        Find the job in the first column. The second column is the feature to reach for, the
        third is the one people often try first, and the last is what to keep in mind.
      </p>
      <template v-for="t in jobTables" :key="t.title">
        <h3 class="wp-guide-h3">{{ t.title }}</h3>
        <p v-if="t.note" class="wp-guide-note">{{ t.note }}</p>
        <GuideTable :head="t.head" :rows="t.rows" />
      </template>
    </DocSection>

    <DocSection title="Which syntax works where">
      <p>
        Each field reads only part of the grammar; the rest stays as text or is dropped. The full
        grammar is on <DocRef id="variable-pipeline" />.
      </p>
      <GuideTable :head="syntaxHead" :rows="syntaxRows" />
      <DocCallout variant="warn">
        A wildcard option can't read a variable. "A $color dress" is either a combine
        (<VarToken>$color dress</VarToken>, the same colour as elsewhere) or an option
        <VarToken kind="ref">@{Colors} dress</VarToken> (a new colour). The two escapes
        <code>$$</code> and <code>@@</code> give a literal <code>$</code> and <code>@</code>.
      </DocCallout>
    </DocSection>

    <DocSection v-for="b in blueprints" :key="b.title" :title="b.title">
      <p>{{ b.intro }} Modules in running order:</p>
      <GuideTable :head="blueprintHead" :rows="b.rows" />
      <p>
        <b>Template:</b> <code class="wp-guide-code">{{ b.template }}</code>
        <template v-if="b.negative"><br><b>Negative template:</b> <code class="wp-guide-code">{{ b.negative }}</code></template>
      </p>
      <ul>
        <li v-for="n in b.notes" :key="n">{{ n }}</li>
      </ul>
    </DocSection>

    <DocSection title="Anti-patterns">
      <p>The traps people hit most, and what to do instead:</p>
      <ul>
        <li v-for="a in antiPatterns" :key="a">{{ a }}</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'prompt-writing', label: 'Writing prompts for your model', icon: 'pi pi-pencil', tone: 'neutral' },
          { id: 'adult-packs', label: 'Adult (NSFW) packs', icon: 'pi pi-shield', tone: 'neutral' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'test-runner', label: 'Test Runner', icon: 'pi pi-bolt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-guide-code { font-family: var(--wp-font-mono); font-size: 0.92em; color: var(--wp-text); }
.wp-guide-h3 { margin: 6px 0 0; font-size: 14px; font-weight: 600; color: var(--wp-text); }
.wp-guide-note { color: var(--wp-text-muted); font-size: 12.5px; }
</style>
