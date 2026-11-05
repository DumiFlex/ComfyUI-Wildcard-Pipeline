<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Hidden variables"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Hide a $variable from the prompt while other modules can still use it."
  >
    <DocSection title="What it does">
      <p>
        Click the <b>globe</b> on a row (or switch on <b>Hide from prompt</b> in its editor) and the
        row's variables print nothing in the prompt. Combines, derivations, constraints and later
        Contexts can still read them. The docs and older messages also call this <i>internal</i>.
      </p>
      <p>
        An example: a hidden <VarToken>$season</VarToken> wildcard picks "winter". A combine below
        it writes <VarToken>$coat</VarToken> as "a $season coat", and a derivation sets
        <VarToken>$weather</VarToken> to "snowing" when the season is winter. The prompt gets the coat
        and the weather, but never the bare word "winter".
      </p>
      <DocUseWhen
        :good="[
          'A pick that decides other picks but shouldn\'t print, like a season, a class or a rating level',
          'Numbers a WP Var node reads',
        ]"
        :better="[
          'Leaving a variable out of one template: just don\'t write it in that template',
        ]"
      />
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li>A hidden variable stays hidden through chained Contexts. Only the Assembler drops it,
          so a later Context can still read it.</li>
        <li>Hiding belongs to the row that wrote the value. If a later module writes the same
          variable without hiding it, it prints again.</li>
        <li>Written in an Assembler template, a hidden variable prints nothing and shows as
          missing. To print something built from it, use a combine and print the combine's
          variable.</li>
        <li>A hidden variable adds nothing to the Assembler's negative output.</li>
        <li>WP Context Loop's <VarToken>$iteration</VarToken> and
          <VarToken>$iteration_total</VarToken> are hidden by default. Click their globe buttons on
          the loop to print them, for example to caption a frame "1 of 4".</li>
        <li>WP Model Info's variables are hidden by default too; switch them on the same way.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'context-chaining', label: 'Context chaining', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'combine', label: 'Combine', icon: 'pi pi-link', tone: 'combine' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
