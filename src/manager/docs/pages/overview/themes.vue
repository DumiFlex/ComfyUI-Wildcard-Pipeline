<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import Banner from "@/kit/Banner.vue";
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
      <p>
        <b>ComfyUI palette</b> dresses the manager in the colour palette ComfyUI is using (ComfyUI
        Settings › Appearance › Color Palette), imported palettes and ones other extensions add included.
        On Dark and Light it wears Native, ComfyUI's own greys; on any other palette the pages, cards,
        borders and text come from the palette's node and text colours, with the text kept readable.
        The palette also decides dark or light, so the Mode setting and the top bar's theme button rest
        while it is the colour theme. Switch the palette in ComfyUI and an open manager tab follows at
        once; with no canvas open, it catches up when you come back to the tab. On <b>Theme's own</b>
        the accent is the palette's own when it has one that reads well, else indigo.
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
        nearly square, and the shapes inside controls follow (a switch's knob and a slider's handle
        turn square with them). Lists, tabs, steps, checkboxes and radios show what's selected the
        look's way (in TUI a checkbox reads <code>[x]</code> and a radio <code>(*)</code>).
      </p>
    </DocSection>

    <DocSection title="Accent colour">
      <p>
        <b>Accent color</b> starts on <b>Theme's own</b>, which follows the colour theme. The presets are
        Indigo, Violet, Teal, Rose and Amber, and <b>Custom</b> opens a picker for any colour. A preset or
        custom accent you pick is kept when you change the colour theme. High contrast keeps its own
        accent so its text stays readable; your pick comes back when you leave it.
      </p>
      <Banner tone="info" note>
        Themes change the manager, and the Community tab follows them: it takes the colour theme, the look
        and light or dark, and changes with them. The canvas nodes follow ComfyUI's colour palette instead (below), so they sit
        well next to other nodes.
      </Banner>
    </DocSection>

    <DocSection title="On the canvas">
      <p>
        WP nodes on the canvas follow ComfyUI's <b>Color Palette</b> (ComfyUI Settings › Appearance). On
        Dark and Light they use their own dark and light colours. On any other palette (Solarized, Arc,
        Nord, Github, a palette another extension adds such as Obsidian or Milk White, or one you
        imported) their rows, fields, borders and text take the palette's node, widget and text colours,
        so a WP node looks like the nodes around it. A palette that is light counts as light even when it
        doesn't say so.
      </p>
      <p>
        Text always stays readable: when a palette's text is too faint on its own widget colour, WP nodes
        use a stronger one. The accent, module kind colours, variable colours and warnings keep their
        meaning on every palette, in their dark or light shades. High contrast still wins over the palette.
      </p>
      <p>
        To keep the WP colours on every palette, set <b>Wildcard Pipeline › Sizing › Canvas colors</b>
        (also in the Display playground and in the manager's Settings › Canvas) to
        <b>Wildcard Pipeline colors</b>.
      </p>
    </DocSection>
  </DocPage>
</template>
