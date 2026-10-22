<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ways = [
  { term: "Constraint", desc: "One pick changes the odds of another: winter rules out summer clothes, stormy makes moody likelier. The usual answer." },
  { term: "Accepts tag group", desc: "The matching choice travels with the option: each outfit lists the shoes that go with it, and $outfit.SHOES prints one of them." },
  { term: "Derivation", desc: "Adds or changes text after a pick: if $season is winter, add \"a scarf\". Use it for text, not for steering another pick." },
  { term: "Reference with a filter", desc: "An option draws from another wildcard, narrowed by tags: \"@{Color:warm} jeans\". Good when the match is always the same." },
];
</script>

<template>
  <DocPage
    group="How to"
    title="Make two picks agree"
    icon="pi pi-link"
    tone="neutral"
    blurb="Stop clashes like a swimsuit in a snowstorm: let one pick steer another."
  >
    <DocSection title="Pick the right tool">
      <DocKeyList :items="ways" />
    </DocSection>

    <DocSection title="With a constraint">
      <ol>
        <li>Tag the options of both wildcards, for example the season wildcard with
          <i>winter</i> and <i>summer</i>, the outfit wildcard with <i>warm</i> and
          <i>light</i>.</li>
        <li>Create a <b>Constraint</b>. Source: the season wildcard. Target: the outfit
          wildcard.</li>
        <li>In the rule matrix set winter × light to <b>Exclude</b>, and summer × warm too. Use
          <b>Boost</b> or <b>Reduce</b> for a nudge instead of a ban.</li>
        <li>On the WP Context, put the constraint between the two wildcards: season, then
          constraint, then outfit.</li>
      </ol>
      <DocImage
        src="images/docs/wildcard-constraint-order.png"
        ratio="16 / 6"
        caption="Source wildcard, then the constraint, then the target wildcard. The #1 badges link the constraint to its target."
      />
      <DocCallout variant="tip">
        Give the target a <b>fallback</b> option, so a combination you didn't plan for still
        prints something. The constraint's <b>Preview</b> shows the odds for every pair before you
        run.
      </DocCallout>
      <p>
        For a strict pairing, such as "maid always wears the frilled apron", use an
        <b>Only</b> rule. More on <DocRef id="constraint" />.
      </p>
    </DocSection>

    <DocSection title="When the deciding value isn't a pick">
      <p>
        Constraints react to picks. To steer from a variable, such as the loaded model from WP
        Model Info, make a wildcard whose options spell the variable's values and set <b>Match
        variable</b> on it. It then picks the matching option and can be a constraint's source.
      </p>
    </DocSection>

    <DocSection title="Check it">
      <p>
        Run the <b>Test Runner</b> over a few hundred seeds: the Samples tab shows every pair that
        came up. Or wire a WP Debug and look at the Trace tab to see which constraint changed which
        odds. A constraint that did nothing shows <i>Constraint never applied</i>; that usually
        means it sits in the wrong place. <VarToken>$season</VarToken> and
        <VarToken>$outfit</VarToken> here are only examples.
      </p>
    </DocSection>

    <DocSection title="Related">
      <CrossLinks
        :links="[
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
