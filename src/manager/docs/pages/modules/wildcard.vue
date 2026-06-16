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

const optionFields = [
  { term: "Value", desc: 'The text that goes into the prompt when this option is picked — for example, "a cat", "a dog", or "a fox".' },
  { term: "Weight", desc: "How likely this option is to be chosen relative to the others. A weight of 2 is twice as likely as a weight of 1. Set to 0 to disable without deleting." },
  { term: "Sub-categories", desc: 'Zero or more labels on an option (e.g. "feline", "warm") — an option can carry several at once. They group options in the editor, form the Constraint matrix axes, power bulk selection, and back the per-use category filter below. Tags can be organised into axes (e.g. species, temperature) so the editor shows grouped pills.' },
  { term: "Null option", desc: 'Marks this option as the "no pick" result — the wildcard resolves to an empty string. At most one option per wildcard can be a null option.' },
];

const instanceOptions = [
  { term: "Random mode", desc: "Pick any option from the pool using its weights. This is the default." },
  { term: "Subcategory mode", desc: "A quick pre-filter that narrows the pool to options carrying a chosen sub-category before the pick. The pick itself is identical to random — only which options are eligible changes. The category filter below is the general, boolean form of it." },
  { term: "Pinned mode", desc: "Locks to one specific option regardless of seed. Use this to hold an element steady across a batch while everything else varies." },
  { term: "Category filter", desc: 'A boolean sub-category expression — "and / or / not", parentheses, and comma as shorthand for "or" (e.g. "feline and warm, not lynx") — that narrows the pool to matching options before the pick. Build it from grouped pills or type it in the advanced editor; it never applies to the null option.' },
  { term: "Exclude null", desc: "Drops the null option for this use, so the wildcard always resolves to real text. Only shown when the wildcard actually has a null option to exclude." },
  { term: "Locked seed", desc: "Freezes this wildcard's pick across every loop iteration — every iteration in the batch gets the same result. Useful for holding one element constant (e.g. the art style) while letting other wildcards vary." },
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
        text too.
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

    <DocSection title="Constraint interaction">
      <p>
        A <b>Constraint</b> module placed between a source wildcard and this one can tilt the
        option weights — for example, making "stormy" more likely when the subject was "ocean".
        The constraint must sit <em>after</em> the source wildcard and <em>before</em> this
        wildcard in the stack. See the Constraint page for the full picture.
      </p>
      <DocImage
        src="images/docs/wildcard-constraint-order.png"
        ratio="16 / 6"
        caption="A WP Context node showing the canonical source → constraint → target stack: Starter subject ($subject · 4 options), Starter pairing (#1 $subject → $mood · 2×2 matrix), Starter mood ($mood · 4 options). The pink left-border on the constraint + target row visually pairs them; the constraint claims the first instance of $mood downstream of itself."
      />
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
