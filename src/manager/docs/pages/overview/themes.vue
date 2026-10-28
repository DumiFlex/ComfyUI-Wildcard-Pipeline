<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import { LOOK_OPTIONS, PALETTE_OPTIONS } from "../../../stores/tweaksStore";
</script>

<template>
  <DocPage
    group="Overview"
    title="Themes and looks"
    icon="pi pi-palette"
    tone="neutral"
    blurb="Pick the manager's colours and its look separately, and mix any of them."
  >
    <p>
      The manager has two theme settings in <b>Settings › Appearance</b>, also in the Tweaks panel
      (the sliders button in the top bar). <b>Colours</b> sets the surfaces, text and accent.
      <b>Look</b> sets everything that is not colour: corners, type, borders and how a selected item is
      drawn. Any colour theme works with any look, in dark and light mode.
    </p>

    <DocSection title="Colours">
      <ul>
        <li v-for="p in PALETTE_OPTIONS" :key="p.id"><b>{{ p.label }}</b>: {{ p.hint }}</li>
      </ul>
      <p>
        Module kind colours (wildcard, fixed value, combine and the rest), variable colours and the teal
        of a picked option stay the same in every theme, so they always mean the same thing.
      </p>
    </DocSection>

    <DocSection title="Look">
      <ul>
        <li v-for="l in LOOK_OPTIONS" :key="l.id"><b>{{ l.label }}</b>: {{ l.hint }}</li>
      </ul>
      <p>
        Picking Compact also switches the sidebar to icons; you can switch it back with the Sidebar setting.
        Density stays its own setting and works with every look.
      </p>
      <p>
        A look reaches every page: in Terminal and TUI every corner is square, Crisp keeps them
        nearly square, and lists, tabs, steps and checkboxes show what's selected the look's way
        (TUI checkboxes read <code>[x]</code>).
      </p>
    </DocSection>

    <DocSection title="Accent colour">
      <p>
        <b>Accent color</b> starts on <b>Theme's own</b>, which follows the colour theme. A preset or
        custom accent you pick is kept when you change the colour theme. High contrast keeps its own
        accent so its text stays readable; your pick comes back when you leave it.
      </p>
      <DocCallout variant="tip">
        Themes change the manager only. The canvas nodes keep ComfyUI's colours, so they sit well next to
        other nodes.
      </DocCallout>
    </DocSection>
  </DocPage>
</template>
