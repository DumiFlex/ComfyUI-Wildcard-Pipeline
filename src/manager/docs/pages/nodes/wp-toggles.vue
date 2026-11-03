<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
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
      <DocImage
        src="images/docs/wp-toggles.png"
        ratio="1720 / 752"
        caption="LoRA character is off, so the LoRA wired into its dot is bypassed and Use its own clothes (which needs it) is off too."
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
        Drag the grip to reorder. A label moves with its toggles. Moving a row never re-points a wire:
        each output stays with its toggle.
      </Banner>
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
        caption="Detailer is off, so the two nodes in its WP Node Group are muted."
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
        <b>Value</b>, or its name; it is internal unless <b>Show in prompt</b> is on.
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
