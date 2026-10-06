<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const tagGroupKinds = [
  { term: "classify (default)", desc: "The tags describe what the option IS — casual, t-shirt, skirt. Several are true at once, so a constraint on this group uses all of them together (AND). This is how every group has always behaved; leaving it alone changes nothing." },
  { term: "accepts", desc: "The tags are alternatives the option OFFERS — an outfit that works with sneakers, heels or sandals. Exactly one is rolled at pick time and read as $var.AXIS, and it's that single rolled tag a constraint keys on — so a diagonal “same tag wins” constraint pins the target to exactly the shoe that was rolled, not the whole accepted set." },
];

const optionFields = [
  { term: "Value", desc: 'The text that goes into the prompt when this option is picked — for example, "a cat", "a dog", or "a fox".' },
  { term: "Weight", desc: "How likely this option is to be chosen relative to the others. A weight of 2 is twice as likely as a weight of 1. Set to 0 to disable without deleting — and if every option ends up at 0, whether you set them or a constraint excluded them, the wildcard resolves to nothing (or to its fallback, below) rather than quietly using the first one." },
  { term: "Sub-categories", desc: 'Zero or more labels on an option (e.g. "feline", "warm") — an option can carry several at once. They group options in the editor, form the Constraint matrix axes, power bulk selection, and back the per-use category filter below. Tags can be organised into axes (e.g. species, temperature) so the editor shows grouped pills.' },
  { term: "Null option", desc: 'Marks this option as the "no pick" result — the wildcard resolves to an empty string. At most one option per wildcard can be a null option.' },
  { term: "Fallback", desc: 'Hover an option\'s probability and click "set as fallback". The fallback rolls like any other option, with its own weight, and is also used when nothing is left to pick: constraints (an Only rule included) excluded every option, the fallback included, or every weight is 0. Give it weight 0 if it should only ever stand in. Without one the wildcard resolves to nothing in that case. One per wildcard; the null option can\'t be the fallback. Turning the fallback off for one use (its checkbox on the node) keeps the empty result there. WP Debug and the Test Runner say "Fallback used" when it kicks in. Shared wildcards with a fallback are stamped schema 9.' },
];

const instanceOptions = [
  { term: "Random mode", desc: "Pick any option from the pool using its weights. This is the default." },
  { term: "Subcategory mode", desc: "A quick pre-filter that narrows the pool to options carrying a chosen sub-category before the pick. The pick itself is identical to random — only which options are eligible changes. The category filter below is the general, boolean form of it." },
  { term: "Pinned mode", desc: "Locks to one specific option regardless of seed. Use this to hold an element steady across a batch while everything else varies." },
  { term: "Category filter", desc: 'A boolean sub-category expression — "and / or / not", parentheses, and comma as shorthand for "or" (e.g. "feline and warm, not lynx") — that narrows the pool to matching options before the pick. Build it from grouped pills or type it in the advanced editor; it never applies to the null option.' },
  { term: "Exclude null", desc: "Drops the null option for this use, so the wildcard always resolves to real text. Only shown when the wildcard actually has a null option to exclude." },
  { term: "Match variable", desc: "Under Runtime in the node settings. Instead of rolling, pick the option whose text equals a variable's value (ignoring case), e.g. model_variant from WP Model Info. No match uses the fallback option; without one the wildcard rolls as usual and WP Debug notes it. This is how a variable drives a constraint: the matched pick is a normal source pick." },
  { term: "Locked seed", desc: "Freezes this wildcard's pick across every loop iteration — every iteration in the batch gets the same result. Useful for holding one element constant (e.g. the art style) while letting other wildcards vary." },
];

const importRules = [
  { term: "One wildcard per list", desc: "Each wildcard becomes its own module, named by its path the way __name__ finds it: animals/cats.txt becomes animals/cats, and a YAML key clothing: { tops: [...] } becomes clothing/tops. Its variable is the last part ($cats, $tops)." },
  { term: "Roles", desc: "The review sorts every wildcard by what it does in the pack. Entry points build a prompt from other wildcards and nothing else uses them: these are what you drop on a Context. Compositions build on other wildcards and are used by one. Vocabulary is a plain list. Groups are made for globs and folder references." },
  { term: "Carries over", desc: "Each wildcard is marked Exact, Close (same outputs, but a setting or label didn't carry over) or Needs a look (some text no longer renders as it did, like a dropped if-condition). Open a row to see why." },
  { term: "Domains", desc: "The top folders (or YAML top keys) of the pack. Pick one to review it on its own. Each wildcard goes in a category named after its domain, unless you type one category for all." },
  { term: "Library tag", desc: "Every module gets the library tag, which starts as the pack's name, so the whole pack sits together on the Tags page." },
  { term: "Bundles", desc: "With Bundle the entry points ticked (the default) the entry points go into one bundle per domain, inside one pack bundle. Lists stay in the library, where the entry points reach them through references, so dropping a bundle rolls the prompts the pack was written to make, not every list. A pack of plain lists gets no bundles." },
  { term: "References", desc: "__other__ references become @{} chips that point at the imported wildcard. A glob like __animals/*__, or a parent key like __clothing__ in Impact packs, becomes a group wildcard that picks one of the matching wildcards, weighted by how many options each has. PPP filters such as __colors'warm'__ become a category filter on the chip." },
  { term: "Choice syntax", desc: "{a|b}, weights like {2::a|b} and multi-pick like {2$$a|b|c} keep working, and so does __2$$name__: it picks two different values of name. Open ranges like {-2$$a|b} get their missing end filled in, samplers like {~a|b} pick at random, and the default separator is a comma." },
  { term: "Weights, labels and fallbacks", desc: "Weighted lines (3::text), PPP labels ('summer, casual'::text) and PPP's else choice carry over as option weights, sub-categories and the wildcard's fallback. A line written twice becomes one option with twice the weight, so the odds stay the same." },
  { term: "Comments and encoding", desc: "Lines starting with # are skipped and kept as the module's description, as is the # text inside multi-line YAML prompts. Text after a # with a space before it is cut (so C# survives). Files saved as UTF-8 or Windows-1252 both read correctly." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Wildcard"
    icon="pi pi-sparkles"
    tone="wildcard"
    blurb="Pick one option at random from a pool and write it to a $variable. The core building block of any pipeline."
  >
    <DocSection title="What it does">
      <p>
        A Wildcard module holds a list of options — "a cat", "a dog", "a fox" — and picks one (or
        several) each run. The result is written to a <VarToken>$variable</VarToken> you name, so
        later modules (and your prompt template) can use it. Options can carry weights so some are
        more likely than others, you can tag them with several sub-category labels to filter on the
        fly, and an option's text can even embed another wildcard — see Multi-pick and Nested
        references below.
      </p>
      <DocImage
        src="images/docs/wildcard-editor.png"
        ratio="16 / 7"
        caption="The Starter subject wildcard modal open on the $subject variable. Two sub-category chips (feline · 2, canine · 2) sit above a four-row pool: cat + tiger tagged FELINE, dog + wolf tagged CANINE, each row showing a 25% probability bar and a weight of 1. Footer carries the Lock pick + Hide from prompt runtime toggles plus the Save to library / Save split."
      />
    </DocSection>

    <DocSection title="Option fields">
      <DocKeyList :items="optionFields" />
    </DocSection>

    <DocSection title="Per-use options">
      <p>
        When you add a wildcard to a Context you can change how it behaves for that use without
        touching the shared library entry:
      </p>
      <DocKeyList :items="instanceOptions" />
      <DocCallout variant="tip">
        Subcategory mode and random mode produce the same result when no sub-category filter is
        active — subcategory mode is just a convenient way to pre-narrow the pool.
      </DocCallout>
    </DocSection>

    <DocSection title="Multi-pick">
      <p>
        By default a wildcard makes a single pick, but a use can draw several at once. Set the
        <b>Pick</b> count to a range — a low and a high (make them equal for a fixed count, e.g.
        2–2) — and the wildcard rolls that many options. A <b>separator</b> joins them, and
        <b>Allow repeats</b> decides whether a draw can land on the same option twice: off (the
        default) keeps the picks distinct, on draws with replacement so repeats are possible.
      </p>
      <p>
        A multi-pick produces a <em>list</em> value. Reference the joined list with a bare
        <VarToken>$name</VarToken> (it uses the separator), or pull out a single item with
        <VarToken>$name.K</VarToken> — <code>K</code> is 0-based, so
        <VarToken>$colors.0</VarToken> is the first pick. For example, a
        <VarToken>$colors</VarToken> wildcard set to Pick 2–3 with separator <code>, </code> might
        resolve to "red, blue, green", while <VarToken>$colors.0</VarToken> is just "red".
      </p>
      <DocCallout variant="tip">
        In multi-pick the null option leaves the pool — set the minimum to <code>0</code> when you
        want "maybe nothing" (a use that sometimes picks fewer, or none). The text-field equivalent
        of multi-pick is the inline pick syntax, covered on
        <DocRef id="variable-pipeline" />.
      </DocCallout>
    </DocSection>

    <DocSection title="Nested references">
      <p>
        An option's value isn't limited to plain text — it can embed a reference to another
        wildcard with <VarToken kind="ref">@{uuid}</VarToken>, so picking that option pulls in a
        fresh pick from the referenced "nested" wildcard. The reference can narrow what the nested
        wildcard may roll with a <VarToken kind="inline">:filter</VarToken> sub-category expression
        and drop its null option with <VarToken kind="inline">!null</VarToken> — for example
        <VarToken kind="ref">@{abcd1234:warm}</VarToken> rolls the nested wildcard but only from its
        warm-tagged options. Inline <VarToken kind="inline">{a|b}</VarToken> picks work in option
        text too. Type <b>@</b> to insert one; the chip states, the full filter grammar
        (<code>not</code> / <code>and</code> / <code>or</code> / parentheses) and why plain
        <code>@name</code> stays text are on <DocRef id="chips-and-references" />.
      </p>
      <DocCallout variant="warn">
        A wildcard is a <b>producer</b>: on its option text,
        <VarToken kind="ref">@{}</VarToken> references and <VarToken kind="inline">{a|b}</VarToken>
        picks resolve, but <VarToken>$name</VarToken> reads do <b>not</b> — an option can't pull in
        a value another module set, no matter the order. To build a value from earlier picks, use a
        Combine or Derivation. The full token grammar and the per-surface gate live on
        <DocRef id="variable-pipeline" />.
      </DocCallout>
    </DocSection>

    <DocSection title="What a tag is, and the two kinds">
      <p>
        A sub-category is a <b>label on an option</b>. It filters the pool and drives the
        Constraint matrix. It is not a variable, and until you say otherwise nothing outside those
        two places can read it.
      </p>
      <p>
        Every tag group carries a kind, chosen on the group's header:
      </p>
      <DocKeyList :items="tagGroupKinds" />
      <p>
        The test is what the tag says about the option. <i>"Is this outfit casual?"</i> is
        classify. <i>"Which shoes go with this outfit?"</i> is accepts.
      </p>
      <p>
        An <b>accepts</b> group can be read as a variable. If a
        <VarToken>$outfit</VarToken> wildcard has an accepts group named
        <VarToken kind="inline">SHOES</VarToken>, then
        <VarToken>$outfit.SHOES</VarToken> is the tag rolled for this run — the same value in
        every template, every module and every chained node, because it is rolled once when the
        option is picked rather than each time it is read. When the wildcard picks more than one
        option, <VarToken>$outfit.0.SHOES</VarToken> is the first pick's.
      </p>
      <DocCallout variant="warn">
        Only <b>accepts</b> groups are readable. Ungrouped tags, and tags in a classify group,
        stay editor-only — <VarToken>$outfit.SHOES</VarToken> renders as nothing if
        <VarToken kind="inline">SHOES</VarToken> was never promoted, and the conflict scanner
        flags it. An accepts group's name is read as
        <VarToken>$var.NAME</VarToken>, so it must be letters, digits and underscores starting
        with a letter; renaming one can strand a template that reads it.
      </DocCallout>
    </DocSection>

    <DocSection title="Constraint interaction">
      <p>
        A <b>Constraint</b> module placed between a source wildcard and this one can tilt the
        option weights — for example, making "stormy" more likely when the subject was "ocean".
        The constraint must sit <em>after</em> the source wildcard and <em>before</em> this
        wildcard in the stack. See the Constraint page for the full picture.
      </p>
      <p>
        Constraints read picks, not variables. To steer one from a variable (the loaded
        checkpoint, an injected value), give the source wildcard options that spell the
        variable's values and set <b>Match variable</b> on it. See WP Model Info for a worked
        example.
      </p>
      <DocImage
        src="images/docs/wildcard-constraint-order.png"
        ratio="16 / 6"
        caption="A WP Context node showing the canonical source → constraint → target stack: Starter subject ($subject · 4 options), Starter pairing (#1 $subject → $mood · 2×2 matrix), Starter mood ($mood · 4 options). The pink left-border on the constraint + target row visually pairs them; the constraint claims the first instance of $mood downstream of itself."
      />
    </DocSection>

    <DocSection title="Importing wildcard packs">
      <p>
        Coming from A1111 or Forge? Open <b>Import / Export → Wildcard packs</b> and choose a folder,
        files or a <code>.zip</code>, or drop them on the page. It reads Dynamic Prompts,
        Prompt Post-Processor (PPP) and Impact Pack wildcards: <code>.txt</code> lists,
        <code>.yaml</code> / <code>.yml</code> and <code>.json</code> files, and <code>.zip</code>
        packs of them. Dropping a pack on the Import tab opens it here too.
      </p>
      <p>
        You go through three steps: load the pack, review the plan, then pick what to import with
        the usual import picker (everything starts selected).
      </p>
      <DocKeyList :items="importRules" />
      <DocImage
        src="images/docs/wildcard-import.png"
        ratio="1148 / 695"
        caption="Billions of Wildcards in review: 2,641 wildcards and 128 groups. The tiles count each role and filter the list when clicked; the bar shows how much carries over exactly. Domains sit on the left, import settings, files and conversion notes on the right."
      />
      <p>
        Importing the same pack again finds the wildcards you already have instead of adding copies.
      </p>
      <DocCallout variant="warn">
        <b>What doesn't carry over.</b> Rows marked <b>Needs a look</b> list what changed. PPP
        <code>if</code> conditions are removed (the choice stays). Dynamic Prompts variables like
        <code>${name}</code> stay as plain text, because a wildcard can't read a variable: rebuild
        that part with a Combine, which can. Template arguments like
        <code>__name(var=value)__</code> are dropped, and a reference to a wildcard the pack doesn't
        contain stays as plain text.
      </DocCallout>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a ready-made <VarToken>$subject</VarToken> wildcard in your library — four options
        ("cat", "tiger", "dog", "wolf") split across two sub-categories. It lands as the first
        piece of the starter set you can build into a full pipeline.
      </p>
      <StarterButton slot="subject" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
