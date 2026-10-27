<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const reweightModes = [
  { term: "Neutral", desc: "No rule. The pair rolls as if the constraint weren't there." },
  { term: "Boost", desc: "Makes the target options more likely, by the factor you set." },
  { term: "Reduce", desc: "Makes them less likely, without removing them." },
  { term: "Exclude", desc: "Removes them from the pool for this source pick." },
  { term: "Only", desc: "Makes the row a guest list. When the source picks this, the target can only pick options this row says something about: the ones set to Only, plus any you boosted or reduced (they keep those odds). Everything the row doesn't mention is off, including options you add later." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Constraint"
    icon="pi pi-filter"
    tone="constraint"
    blurb="Make one wildcard's pick change the odds of another's: boost, reduce, rule out or allow only some options. It sets no $variable itself."
  >
    <DocSection title="What it does">
      <p>
        A constraint watches the pick of a <em>source</em> wildcard and changes the odds of a
        <em>target</em> wildcard below it, before the target rolls. The target still picks at
        random; you're only shifting the odds.
      </p>
      <p>
        Example: when <VarToken>$weather</VarToken> picks "stormy", boost "dramatic" and "moody" in
        <VarToken>$mood</VarToken> and reduce "sunny" and "cheerful".
      </p>
      <DocImage
        src="images/docs/constraint-matrix.png"
        ratio="2 / 1"
        caption="The Starter pairing constraint: feline subjects lean intense, canine subjects lean calm. Below are exceptions and the target reach (First, Next N, All, Pick)."
      />
      <DocUseWhen
        :good="[
          'Two picks that must agree (winter rules out summer clothes)',
          'Whole families of options with the tag matrix, single pairs with exceptions',
          'Allow-lists with Only',
        ]"
        :better="[
          'Adding text: use a Derivation',
          'A narrowing that never changes: a category filter or @{X:tag}',
        ]"
      />
    </DocSection>

    <DocSection title="Make one">
      <ol>
        <li>Create a constraint and pick the <b>Source wildcard</b> (the one that decides) and the
          <b>Target wildcard</b> (the one that follows).</li>
        <li>In the <b>Rule matrix</b>, set a rule for whole tag pairs: rows are the source's tags,
          columns the target's. For example, winter × summer clothes = Exclude.</li>
        <li>Add <b>Exceptions</b> for single option pairs. An exception wins over the matrix.</li>
        <li>Check the <b>Preview</b>, save, and add the constraint to your WP Context between the two
          wildcards.</li>
      </ol>
      <DocFlow figure="constraint-flow"
        :stages="[
          { icon: 'pi pi-sparkles', name: 'Source wildcard', sub: 'its pick', tone: 'wildcard' },
          { icon: 'pi pi-filter', name: 'Constraint', sub: 'reweights', tone: 'constraint' },
          { icon: 'pi pi-sparkles', name: 'Target wildcard', sub: 'picks to match', tone: 'wildcard' },
        ]"
        :arrows="['if it lands on X', 'limits']"
        caption="Order in the stack: source, then constraint, then target."
      />
      <DocCallout variant="warn">
        Order matters: the source sits above the constraint, and the target below it. The source
        must be a wildcard in the stack; a pick made only inside a reference sets no variable, so a
        constraint on it never applies.
      </DocCallout>
    </DocSection>

    <DocSection title="Rule modes">
      <DocKeyList :items="reweightModes" />
    </DocSection>

    <DocSection title="Linking picks with Only">
      <p>
        Only ties one wildcard's pick to another's. Add an exception maid → frilled apron in Only
        mode, and whenever the source picks "maid" the target can only pick "frilled apron". You
        don't list every outfit to rule out.
      </p>
      <ul>
        <li>Several Only exceptions for the same source value make a short list: "maid" can pick
          "frilled apron" or "kimono" and nothing else.</li>
        <li>In the matrix, Only works on tags: summer → open means a summer pick can only reach
          targets tagged open. The rest of that row shows a faint × so you can see what's shut out. A
          Neutral cell doesn't count as a rule.</li>
        <li>Boost and Reduce in the same row stay on the guest list with their odds. Formal → Only
          heels, Boost loafers ×2: a formal outfit gets heels or loafers (loafers twice as often),
          never sneakers or boots.</li>
        <li>Other source values are unaffected: a "biker" pick still rolls every outfit.</li>
      </ul>
    </DocSection>

    <DocSection title="Preview">
      <p>
        The <b>Preview</b> card shows the constraint in numbers: one row per source option, one
        column per target option, and in each cell the chance of that target option when the source
        picked that row. A dash means ruled out. A row marked <b>nothing left</b> would leave the
        target empty, and <b>fallback</b> means the target's fallback option stands in. Other
        constraints, filters and toggles aren't included.
      </p>
    </DocSection>

    <DocSection title="When it rules out everything">
      <p>
        If, for some source value, every target option is excluded or shut out, the target would come
        out empty. The constraint row then shows a <b>rules out all</b> badge before you run; hover
        it to see which source values do it. Allow an option for those values, or mark one of the
        target's options as its <b>fallback</b>.
      </p>
    </DocSection>

    <DocSection title="A missing source or target">
      <p>
        If the constraint's source or target isn't in your library (you installed it without its
        wildcards, or deleted one), the editor shows the missing wildcard's name and locks the
        matrix. <b>Reattach</b> points it at a wildcard you have, or <b>Download from community</b>
        fetches the missing one. The rules are then mapped onto the new wildcard's tags; rules for
        tags it doesn't have are dropped, and the editor shows how many first.
      </p>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter constraint: feline subjects lean intense, canine subjects lean calm. It also
        creates the two wildcards it needs (<VarToken>$subject</VarToken> and
        <VarToken>$mood</VarToken>) if you don't have them yet.
      </p>
      <StarterButton slot="pairing" />
    </DocSection>

    <DocSection title="Works with">
      <p>
        Several constraints on one target, reaching only some uses of a wildcard, tag axes and
        wildcards used inside references: see <DocRef id="constraints" />.
      </p>
      <CrossLinks
        :links="[
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
