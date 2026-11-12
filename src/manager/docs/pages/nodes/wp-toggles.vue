<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Toggles"
    icon="pi pi-check-square"
    tone="node"
    node-id="WP_Toggles"
    blurb="Several on/off switches in one node. Each writes a true/false $variable for rules and can have a BOOLEAN output."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Toggles</b> replaces a stack of Boolean nodes. Each toggle writes
        <VarToken>$its_variable</VarToken> as <code>true</code> or <code>false</code>, so a derivation
        can branch on it without a Context Injector, and can show a BOOLEAN output at the right of its
        row for a switch node.
      </p>
      <DocAnnotated
        src="images/docs/wp-toggles.png"
        ratio="1720 / 860"
        caption="Hires fix is on and Quick preview off: their BOOLEAN outputs feed ComfyUI's If/Else Switch and two Preview as Text nodes, which print what the run sent (True, False, and the switch's pick). Detailer is off, so the text node wired into its dot is muted."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Switches you flip by hand: use a LoRA, add a detailer, day or night',
          'Paths a rule picks between: $use_lora_character in a derivation',
        ]"
        :better="[
          'A switch a random pick should flip: a wildcard and WP Var → Bool',
        ]"
      />
    </DocSection>

    <DocSection title="Controls">
      <DocFields node="WP_Toggles" group="controls" />
    </DocSection>

    <DocSection title="Editing a toggle">
      <DocFields node="WP_Toggles" group="edit" />
      <Banner tone="info" note>
        Drag the grip to reorder: the row you drop beside opens a gap with a line. An indented
        line in a group's colour puts the toggle in that group (a folded one opens); a
        full-width line, just above a label or below the last row, puts it below the group, in no
        group. A label moves with its toggles and lands only between groups. Moving a row never
        re-points a wire: each output stays with its toggle.
      </Banner>
    </DocSection>

    <DocSection title="Icons and colours">
      <p>
        Give a toggle an icon and its own colours under <b>Looks</b> in its window: one for the
        icon, one for the name and one for the control itself, so Day can glow yellow and Night blue.
        A label's icon and colour buttons do the same for the group, and its toggles wear that
        colour on their left edge. The row at the top of the toggle's window shows each change
        before you press Done.
      </p>
    </DocSection>

    <DocSection title="Use a toggle in the prompt">
      <p>
        A toggle's variable is internal by default: rules read it, but the Assembler doesn't offer
        it, since <code>true</code> or <code>false</code> rarely belongs in a prompt. To print it, open
        the edit view and turn off the globe on its row. In Pick one, <b>Show in Assembler</b> does the
        same for the picked variable, so <VarToken>$time</VarToken> can print the picked toggle's
        <b>Value</b>.
      </p>
      <p>
        Give a toggle a <b>Value</b> and its variable holds that text while it is on and nothing
        while it is off: a Rain toggle with the Value "heavy rain" makes
        <VarToken>$rain</VarToken> print "heavy rain" or nothing. The switch itself is still there as
        <VarToken>$rain.bool</VarToken>, <code>true</code> or <code>false</code>, for rules and
        conditions. Its <b>Negative</b> goes with the variable while it is on, so an Assembler that
        prints <VarToken>$rain</VarToken> also sends "sunny, dry" to its negative output.
      </p>
      <p>
        In Any on a toggle can also say what to write while it is <b>off</b>: its <b>Off value</b>
        and <b>Off negative</b>. A Buttons toggle Anime / Real with the Value "anime style" and the
        Off value "photorealistic" writes one or the other, and each side's negative keeps the other
        look out. Leave them empty and off prints nothing, as before.
      </p>
    </DocSection>

    <DocSection title="Mute or bypass nodes">
      <p>
        Set a toggle's <b>When off</b> to <b>Mute</b> or <b>Bypass</b> and its row gets a dot on the
        left. Wire any node's output into it, or a <b>WP Node Group</b> to drive several. Turning the
        toggle off mutes or bypasses them; turning it on lets them run. Needs and Pick one count:
        a toggle that is off because of them drives its nodes off too. A toggle can do all of it at
        once: write <VarToken>$its_variable</VarToken>, send its BOOLEAN and mute or bypass. Once
        something is wired, an icon next to the name shows it: coloured while it is muting or
        bypassing, dim while not; hover it for the nodes.
      </p>
      <DocImage
        src="images/docs/wp-node-group.png"
        ratio="1720 / 752"
        caption="Two nodes in a group, wired into Detailer's dot. Detailer is off, so both are muted."
      />
      <Banner tone="info" note>
        This happens on the canvas, the moment the toggle flips, so the saved workflow keeps the
        modes. The wires to the dots never reach the run. An upstream value that sets a toggle
        changes its variable and output, not the modes.
      </Banner>
    </DocSection>

    <DocSection title="Pick one">
      <p>
        One toggle is on. Which one, first match wins: the toggle the upstream picked variable
        names (with <b>Upstream can pick</b>), then the first toggle upstream set to a yes word,
        then the first one you switched on. The picked variable gets the toggle's
        <b>Value</b>, or its name; it is internal unless <b>Show in Assembler</b> is on. A toggle's
        <b>Negative</b>, under its Value, goes with the picked variable: an Assembler that prints it
        sends those words to its negative output. All rows share one look here:
        the <b>Style</b> next to those boxes picks Radio (the default), Chip, Switch or Check, so a
        toggle's own Style and Needs are hidden.
      </p>
    </DocSection>

    <DocSection title="Rows or a grid">
      <p>
        The <b>Layout</b> switch in the edit bar draws the node as Rows (one row per toggle, the
        default) or as a Grid: each toggle in a tile, the tiles wrapping to the node's width, in
        both modes and every style. Each label has a grid button for its own group, so one group
        can be a grid while another stays rows. Under a grid's tiles, thin lines carry the dots:
        mute/bypass dots stack on the left with their toggle's name and BOOLEAN outputs on the
        right with theirs, each side packed on its own, so one line can hold two toggles. The arrow on the first line merges the group's lines into one that carries
        every dot and says how many go in and out (the names on hover), like the Context Injector's merged wires. Rows keep their dots on the row, and
        the edit view always shows rows so you can reorder them.
      </p>
    </DocSection>

    <DocSection title="Merge the Boolean nodes you have">
      <p>
        Select Boolean nodes, right-click one and pick <b>Merge into WP Toggles</b>. Each becomes a
        toggle named after its title, keeps its value, and its wires move to the matching output. A node
        can merge when its only output is BOOLEAN, nothing is wired into it and it has one on/off value,
        so ComfyUI's Boolean and most pack toggles work. Ctrl+Z undoes the merge.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context-injector', label: 'WP Context Injector', icon: 'pi pi-sign-in', tone: 'node' },
          { id: 'wp-var-to-bool', label: 'WP Var → Bool', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-node-group', label: 'WP Node Group', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-mode-relay', label: 'WP Mode Relay', icon: 'pi pi-arrow-right-arrow-left', tone: 'node' },
          { id: 'wp-model-info', label: 'WP Model Info', icon: 'pi pi-microchip', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
