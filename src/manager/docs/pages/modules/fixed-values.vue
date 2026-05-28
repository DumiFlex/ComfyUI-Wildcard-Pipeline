<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";

const rowFields = [
  { term: "Name", desc: 'The $variable name to set — for example, "style" sets $style.' },
  { term: "Value", desc: "The text to assign. You can use inline {a|b|c} pick syntax here to add a touch of randomness, but you cannot read other $variables — use Combine for that." },
  { term: "Enable / disable", desc: "Turn a row off without deleting it. Useful for toggling optional extras like a quality booster or a negative-prompt fragment." },
];

const instanceOptions = [
  { term: "Value override", desc: "Replace the value of any row for this particular use, without changing the shared library entry. Good for adapting a reusable Fixed Values module to a specific workflow." },
  { term: "Locked seed", desc: "Freezes any inline {a|b|c} picks across loop iterations so the value stays the same throughout a batch." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Fixed Values"
    icon="pi pi-tag"
    tone="fixed_values"
    blurb="Set one or more $variables to exact text values. The simplest way to inject a constant into the pipeline."
  >
    <DocSection title="What it does">
      <p>
        A Fixed Values module lets you write plain name = value pairs into the Context. Every time
        the pipeline runs, those <VarToken>$variables</VarToken> are set to whatever text you typed.
        Nothing is picked at random (unless you use inline <VarToken kind="inline">{a|b|c}</VarToken>
        syntax inside the value), and nothing depends on other modules — it just stamps the values in.
      </p>
      <p>
        Use it for anything that should stay constant: an artist style like "oil painting", a
        quality booster like "8k, masterpiece", or a reusable negative-prompt fragment. Drop it at
        the top of your stack and every module below can read those variables.
      </p>
      <DocImage
        src="images/docs/fixed-values.png"
        ratio="16 / 6"
        caption="The Starter style Fixed Values modal — two name → value rows ($style = oil painting, $quality = 8k, masterpiece) each with their own enable checkbox, footer reading '2 of 2 enabled · 1 added' to flag the instance-added row over the library baseline. Lock seed + Hide from prompt runtime toggles below. Behind the modal: a WP Context stack with Starter style (MOD-flagged orange border), Starter scene, Starter accent."
      />
    </DocSection>

    <DocSection title="Row fields">
      <DocKeyList :items="rowFields" />
    </DocSection>

    <DocSection title="Per-use options">
      <p>
        When you add a Fixed Values module to a Context you can adjust it for that use:
      </p>
      <DocKeyList :items="instanceOptions" />
      <DocCallout variant="tip">
        Fixed Values cannot read <VarToken>$variables</VarToken> that other modules have set — it
        is a producer, not a consumer. If you need to build a value from earlier picks, use a
        Combine module instead.
      </DocCallout>
    </DocSection>

    <DocSection title="Try it">
      <p>
        Create a starter Fixed Values module that sets <VarToken>$style</VarToken> to "oil
        painting". It's the constant the starter set's prompt template reuses every run — drop it in
        and every module below can read it.
      </p>
      <StarterButton slot="style" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'combine', label: 'Combine', icon: 'pi pi-link', tone: 'combine' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
