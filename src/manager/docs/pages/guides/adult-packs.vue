<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import GuideTable from "./GuideTable.vue";

const safeguards = [
  { term: "No minors, ever", desc: "Never make sexual or suggestive content of minors or of characters presented as minors, in any form, and never loli or shota content. This holds whatever the request, whatever a canon age claim says (\"she's really 1000 years old\") and whatever the art style." },
  { term: "Adult anchors", desc: "Every character in a pack that can reach suggestive or explicit carries a positive adult anchor: \"mature female\" or \"mature male\" plus adult body descriptors on tag models, \"an adult woman in her 30s\" on sentence models. Use ages of 25 and up where a model reads ages." },
  { term: "Youth negative block", desc: "Every such render carries the youth block in its standing negative: \"child, loli, shota, toddler, aged down, young\" on tag models, \"child, minor, teenager, young girl, young boy, childlike\" on sentence models." },
  { term: "No youth-coded content", desc: "School uniforms, school settings, childlike props and age numbers under 18 are safe-only options. Never pair petite or small body descriptors with youth-coded tags or a \"cute, small\" style. Named characters whose canon age is under 18 stay out of adult registers, even drawn \"aged up\"." },
  { term: "No real people", desc: "No real person's name, likeness or lookalike description, including real cosplayers." },
  { term: "Blocklist backstop", desc: "A WP Prompt Cleaner blocklist after the Assembler catches what slips through. It matches whole words, so list every variant (below)." },
];

const blueprintRows: string[][] = [
  ["1", "Rating", "Wildcard", "`$_rating`", "safe (fallback), suggestive, explicit. Hide from prompt. Untick the levels a node must never reach"],
  ["2", "Rating → Rating tag", "Constraint", "", "Only on the diagonal: safe → safe, suggestive → suggestive, explicit → explicit"],
  ["3", "Rating tag", "Wildcard", "`$rating_tag`", "Your family's words (table below), tagged safe, suggestive, explicit"],
  ["4", "Character bundle", "Bundle", "`$character`, `$body`, `$hair`, `$eyes`", "`$character` starts with the person's count tag (`1girl`, `1boy`). Every option of `$body` carries the adult anchor (`mature female, curvy`, `mature male, muscular`). Hold across run"],
  ["5", "Rating → Clothing state", "Constraint", "", "Matrix with Only cells: safe allows fully clothed; suggestive adds revealing and underwear; explicit allows the whole ladder"],
  ["6", "Clothing state", "Wildcard", "`$clothing_state`", "The ladder below, each option tagged with its register and with what it needs (top, bottom, none). Option negatives by state"],
  ["7", "Clothing state → Outfit", "Constraint", "", "topless → Only bottoms; bottomless → Only tops; underwear only → Only underwear; nude → Only the outfit's null option"],
  ["8", "Outfit", "Wildcard", "`$outfit`", "Tagged top, bottom, one piece, underwear. A null option. School uniforms tagged safe only, and excluded from the other registers"],
  ["9", "Rating → Pose", "Constraint", "", "Only the poses tagged for that register"],
  ["10", "Pose", "Wildcard", "`$pose`", "Tagged by register and by framing"],
  ["11", "Pose → Camera", "Constraint", "", "Framing that fits the pose (\"on back\" with \"from above\"; \"from behind\" without face detail)"],
  ["12", "Camera", "Wildcard", "`$camera`", "Framing tags: portrait, upper body, cowboy shot, full body"],
  ["13", "Rating → Act", "Constraint", "", "safe and suggestive: Only the act's null option"],
  ["14", "Act", "Wildcard", "`$act`", "Explicit only. One act per option, each starting with the partner's count tag and the pairing tag (`1boy, hetero, ...`), so the counts never disagree with the act"],
  ["15", "Solo when alone", "Derivation", "`$count`", "IF `$act` has no value (NOT with \"has value\") → `solo`"],
  ["16", "Clothing state → Place", "Constraint", "", "Undressed states boost private places (bedroom, onsen, shower); public places with nudity only as a deliberate theme"],
  ["17", "Censorship", "Fixed values", "`$censor`", "`uncensored` with negative `censored, mosaic censoring, bar censor`, or the reverse. Switch it by hand; never roll it"],
];

const ladderRows: string[][] = [
  ["fully clothed", "safe, suggestive, explicit", "top and bottom, or one piece", "`nude, nipples` (in a suggestive register)"],
  ["revealing clothes", "suggestive, explicit", "top and bottom, or one piece", "`nude`"],
  ["open shirt, shirt lift, clothes pull, clothing aside", "explicit", "the garment the state acts on (a shirt for open shirt, a skirt for skirt lift)", ""],
  ["topless", "explicit", "bottoms only", "`bra, shirt`"],
  ["bottomless", "explicit", "tops only", "`skirt, pants, panties`"],
  ["underwear only, lingerie", "suggestive, explicit", "underwear only", "`dress, shirt, pants`"],
  ["nude, completely nude", "explicit", "no garments (accessories only if the template says so)", "`clothes, underwear, panties, bra`"],
];

const familyRows: string[][] = [
  ["Pony V6", "`rating_safe`, `rating_questionable`, `rating_explicit`, after the score and source tags", "Trained on equal thirds of each rating. For safe output on a mixed merge: `rating_safe` in the prompt and `rating_explicit` in the negative"],
  ["Pony V7", "`rating_*` special tags", "Much weaker than V6's special tags; lean on the description"],
  ["Illustrious", "Danbooru's levels: `general`, `sensitive`, `questionable`, `explicit`, or the merge's own form (`nsfw`, `rating:explicit`)", "Read the merge's page"],
  ["NoobAI", "`safe`, `sensitive`, `nsfw`, `explicit`", "The default prefix has `safe` and the default negative has `nsfw`. For adult work swap the prefix word and take `nsfw` out of the negative"],
  ["Animagine 3.1 / 4.0", "`safe`, `sensitive`, `nsfw`, `explicit, nsfw`", "4.0 puts the rating right after the series"],
  ["Anima", "`safe` in the default prefix; the same four levels as NoobAI", "Turbo runs at CFG 1, so the negative is ignored. Non-commercial licence"],
  ["Chroma", "Plain description", "Reported to be trained without a safety filter; real negatives work"],
  ["SDXL base, SD 3.5, Flux.1, Qwen-Image, Z-Image", "None", "Weak or absent explicit anatomy. Adult work needs a fine-tune or LoRA; Flux is a poor default"],
  ["Realistic merges", "The merge's own", "Follow the merge's page"],
];

const coherence: string[] = [
  "One clothing state per character, picked first. Everything else follows it: the outfit only draws garments the state allows, and \"open shirt\" needs a shirt, \"skirt lift\" a skirt.",
  "The negative follows the state: nude puts clothes in the negative, topless puts a bra and shirt there, fully clothed in a suggestive register puts nudity there. This is the best use of option negatives in an adult pack.",
  "Pose decides framing and what is visible. Constrain the camera by the pose rather than rolling them apart. Framing is also the main lever for keeping explicit detail where you want it.",
  "One act per image, with the people counted: \"1girl, 1boy, hetero\" for a couple, \"2girls, yuri\", \"solo\" for one person. Several acts at once fuse bodies.",
  "Body description is identity, not variety. Hold it across a run. In adult packs it also carries the adult anchor, so it is never optional.",
  "The expression fits the act and register. Avoid pairs that fight (smile and crying) unless you mean it.",
  "Standing anatomy negatives: \"bad anatomy, extra arms, extra legs, extra fingers, fused fingers, missing limbs, deformed\". Add \"extra people\" when the count is small.",
  "The rating tag must agree with the content. rating_safe with nude fights itself; rating_explicit on a clothed café scene drifts toward nudity. That is why the rating tag comes from the same driver as the slots.",
];

const vocab = [
  { term: "Use common tags", desc: "Danbooru tags with fewer than about 5,000 posts are learned weakly. Prefer the high-count synonym (\"nude\" over a rare variant)." },
  { term: "Clothing state", desc: "The ladder above uses real Danbooru tags: open clothes, open shirt, clothes pull, shirt lift, skirt lift, clothing aside, topless, bottomless, underwear only, lingerie, nude, completely nude, naked towel." },
  { term: "Adult body", desc: "mature female, mature male, curvy, wide hips, toned, muscular female, abs. These are also the standard steer toward clearly adult depictions on anime models." },
  { term: "Count and pairing", desc: "1girl, 1boy, 2girls, solo; hetero, yuri, yaoi. They come first, before the character." },
  { term: "Acts and positions", desc: "Danbooru keeps these in its \"sexual positions\" and \"sex acts\" tag groups. Draw one per image from a short, curated list, never from a full group dump." },
  { term: "Censorship", desc: "About a third of Danbooru's explicit art is censored (\"censored\" 456K posts against \"uncensored\" 134K), so Danbooru models add mosaics or bars by default. \"uncensored\" in the prompt plus \"censored, mosaic censoring, bar censor\" in the negative turns that off; the reverse turns it on." },
  { term: "Sentence models", desc: "Describe plainly and clinically, with the adult anchor in the same sentence as the person (\"an adult woman in her 30s, nude, lying on a bed in a dim bedroom\")." },
  { term: "CFG 1 models", desc: "The negative is ignored, so a safe guard must be positive wording (\"fully clothed in a buttoned wool coat\") plus constraints." },
];

const blockVariants: string[][] = [
  ["child", "children, childlike, childish, child's"],
  ["kid", "kids, kiddo"],
  ["loli", "lolis, lolicon"],
  ["shota", "shotas, shotacon"],
  ["toddler", "toddlers"],
  ["minor", "minors (this also removes \"minor\" in other senses)"],
  ["underage", ""],
  ["teen", "teens, teenage, teenager, teenagers, preteen"],
  ["schoolgirl", "schoolgirls, schoolboy, schoolboys"],
  ["young girl", "little girl, young boy, little boy"],
  ["aged down", ""],
];

const checklist: string[] = [
  "The library's content rating is set to nsfw. It is only a label for lists and publishing, but it tells others what the pack is.",
  "Every character's identity option carries an adult anchor, and Hold across run keeps it for the whole Loop.",
  "The youth block is in the Assembler's negative template itself, not only in option negatives, so it is there on every render.",
  "No option reachable from suggestive or explicit holds a youth term, a school item or a real person. Pin the Rating wildcard to each level in the Test Runner and read the prompts.",
  "The Cleaner's blocklist lists every variant, and stays off in the Cleaner's negative column (its default there), where it would strip the youth block.",
  "Detailer, inpaint and Image Filter prompts carry the adult anchors too. A blank ADetailer prompt reuses the main prompt; a custom one or an edited prompt in the picker is a new prompt.",
  "The pack says it needs CFG above 1 if it relies on negatives.",
  "The model's licence and the host's rules allow the use. Some models restrict adult or commercial use (Anima's licence is non-commercial).",
  "No imported tag dumps. Third-party adult wildcard files and raw tag-group files include prohibited categories; curate by hand.",
  "Non-consent themes and categories that sharing sites ban (incest, self-harm, bodily excretion and similar) are not in the pack.",
];
</script>

<template>
  <DocPage
    group="Guides"
    title="Adult (NSFW) packs"
    icon="pi pi-shield"
    tone="neutral"
    blurb="How to build a pack for adult characters on models trained for it: a rating driver, a clothing-state ladder, the rules that keep picks coherent, the tag vocabulary per family, and the safeguards every adult pack must carry."
  >
    <DocSection title="Safeguards (required)">
      <DocCallout variant="danger">
        These rules are not optional. A pack that can reach suggestive or explicit content
        follows all of them, on every model, for every character.
      </DocCallout>
      <DocKeyList :items="safeguards" />
      <p>
        The safeguards work in layers, and no single layer is enough: constraints keep youth-coded
        options out of adult registers at the source, the adult anchor steers every character in
        the prompt, the youth block pushes away in the negative (at CFG above 1), and the
        blocklist removes what slipped through.
      </p>
      <p>
        <b>For your pack:</b> build the safeguards first, before any content. They are a few
        fixed values, one negative template and one Cleaner node.
      </p>
    </DocSection>

    <DocSection title="Register is a variable, not a label">
      <p>
        The library's <b>content rating</b> (safe or nsfw) is a label for lists and publishing.
        It changes nothing in a run. What decides how explicit an image gets is a hidden
        <b>rating driver</b>: one wildcard, picked once, that every adult slot is constrained by.
        The same driver picks the model's rating tag, so the tag and the content never disagree.
      </p>
      <ul>
        <li>To cap a node at safe or suggestive, untick the higher levels on that use of the Rating wildcard. Nothing downstream can reach them then.</li>
        <li>For one model family, a Rating tag wildcard plus a diagonal Only constraint maps the level to the right word. For a pack that serves several families, a derivation with AND conditions on <code>$model_variant</code> and <code>$_rating</code> writes it instead.</li>
        <li>On a mixed model, the safe level also needs a guard: Pony's <code>rating_safe</code> in the prompt and <code>rating_explicit</code> in the negative; NoobAI's and Anima's <code>safe</code> prefix word. On CFG 1 models the guard must be positive wording.</li>
      </ul>
      <p>
        <b>For your pack:</b> one rating driver per pack, first in the stack, hidden. Never roll
        the rating tag on its own.
      </p>
    </DocSection>

    <DocSection title="Blueprint: rating-aware adult pack">
      <p>Modules in running order, for a Danbooru-tag model:</p>
      <GuideTable :head="['#', 'Module', 'Kind', 'Writes', 'Options and settings']" :rows="blueprintRows" />
      <p>
        <b>Template:</b> <code class="wp-guide-code">$quality, $rating_tag, $character, $count, $act, $body, $hair, $eyes, $clothing_state, $outfit, $pose, $expression, $place, $camera, $censor, $style</code><br>
        <b>Negative template:</b> <code class="wp-guide-code">$negatives, child, loli, shota, toddler, aged down, young, bad anatomy, extra arms, extra legs, extra fingers, watermark</code>
      </p>
      <ul>
        <li>The count tags come first: the character's own, then <code>solo</code> or the partner's from the act. Below explicit the act is empty, so the derivation writes <code>solo</code>.</li>
        <li>An Only rule pointing at a null option is how a constraint says "nothing here": for a nude state the outfit prints nothing, and below explicit the act prints nothing.</li>
        <li>On a sentence model, keep the same modules and write the options as phrases. A combine builds each person's sentence with the adult anchor in it.</li>
        <li>For two adults, insert the character bundle twice with the second copy's variables renamed, give each an anchor, and hold both. Regional prompting or one Assembler per person keeps their traits apart.</li>
      </ul>
    </DocSection>

    <DocSection title="The clothing-state ladder">
      <p>
        A graded wildcard of clothing states, tagged by the registers that may use each and by
        what each needs from the outfit:
      </p>
      <GuideTable :head="['State', 'Registers', 'Outfit allowed', 'Option negative']" :rows="ladderRows" />
      <p>
        <b>For your pack:</b> the state is a decision (constraints read it), so it is its own
        wildcard. Its option negatives follow usage, so each state pushes away exactly the
        garments it rules out. Under a Loop, a planned sequence can step along the ladder with
        per-frame overrides or a Frame wildcard and a constraint, while the character and outfit
        stay held.
      </p>
    </DocSection>

    <DocSection title="Coherence rules">
      <ol>
        <li v-for="c in coherence" :key="c">{{ c }}</li>
      </ol>
      <p>
        <b>For your pack:</b> every rule here is a constraint between two wildcards, or an option
        negative. Write the rule once and the pack keeps it on every seed.
      </p>
    </DocSection>

    <DocSection title="Rating tags by model family">
      <p>
        Danbooru rates every post general, sensitive, questionable or explicit. Each model family
        maps those four levels to its own words:
      </p>
      <GuideTable :head="['Family', 'Rating words', 'Notes']" :rows="familyRows" />
      <p>
        <b>For your pack:</b> exactly one rating word per prompt, in the family's head (see
        <DocRef id="prompt-writing" /> for where the head goes).
      </p>
    </DocSection>

    <DocSection title="Tag vocabulary norms">
      <DocKeyList :items="vocab" />
      <p>
        <b>For your pack:</b> curate short lists of well-known tags. A small list of coherent
        options beats a large one that can contradict itself.
      </p>
    </DocSection>

    <DocSection title="Setting up the blocklist">
      <p>
        <DocRef id="wp-prompt-cleaner" />'s blocklist in list mode matches each entry as a whole
        word, ignoring case. In tags mode it drops the whole tag that contains the word; in text
        mode it removes just the word. Because it matches whole words, blocking <code>child</code>
        does not touch <code>children</code> or <code>childlike</code>. List every form:
      </p>
      <GuideTable :head="['Entry', 'Also list']" :rows="blockVariants" />
      <p>
        Or switch the blocklist to regex mode, one pattern per line, such as
        <code>\bchild\w*</code>, <code>\bkids?\b</code>, <code>\b(loli|shota)(s|con)?\b</code>,
        <code>\btoddlers?\b</code>, <code>\b(pre)?teen(s|age|ager|agers)?\b</code>,
        <code>\bschool ?(girl|boy)s?\b</code>, <code>\b(little|young) (girl|boy)s?\b</code>
        and <code>\baged down\b</code>.
      </p>
      <DocCallout variant="warn">
        Don't block <code>young</code> on its own in the positive: it would also cut "young
        woman" style wording without making anything safer. Keep it in the negative block. When
        the Cleaner also cleans the negative, leave the blocklist off in its negative column (the
        default there), or it would remove the youth block.
      </DocCallout>
      <p>
        <b>For your pack:</b> the blocklist is the last layer, not the first. If it ever removes
        something, fix the option that produced it.
      </p>
    </DocSection>

    <DocSection title="Second passes and edits">
      <ul>
        <li>ADetailer and FaceDetailer reuse the main prompt when their prompt is blank. A custom detailer prompt must carry the adult anchors.</li>
        <li>An inpaint edit, or a prompt edited in WP Image Filter's picker, is a new prompt. It needs the anchors and, at CFG above 1, the youth block.</li>
        <li>Artistic nude and explicit are different registers. Artistic nude uses photography and fine-art words (light, pose, medium) at the questionable level.</li>
        <li>Horror gore is an adult register too: label it nsfw and gate it behind the rating driver.</li>
      </ul>
      <p>
        <b>For your pack:</b> a second Assembler for the detailer, reading the same Context,
        renders the face slots plus the anchor variable, so the anchor can't be forgotten.
      </p>
    </DocSection>

    <DocSection title="Before you share">
      <ul>
        <li v-for="c in checklist" :key="c">{{ c }}</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'pack-structure', label: 'Recommended pack structure', icon: 'pi pi-th-large', tone: 'neutral' },
          { id: 'prompt-writing', label: 'Writing prompts for your model', icon: 'pi pi-pencil', tone: 'neutral' },
          { id: 'wp-prompt-cleaner', label: 'WP Prompt Cleaner', icon: 'pi pi-ban', tone: 'neutral' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'negatives', label: 'Negatives', icon: 'pi pi-minus-circle', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-guide-code { font-family: var(--wp-font-mono); font-size: 0.92em; color: var(--wp-text); }
</style>
