<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const controls = [
  { term: "upstream (in)", desc: "Optional Context to extend. Only nodes after this one see the toggle variables." },
  { term: "Any on / Pick one", desc: "Any on: every toggle is on or off by itself. Pick one: exactly one is on, like radio buttons." },
  { term: "writes (Pick one)", desc: "Optional variable that also gets the picked toggle's name, so one rule can branch on it." },
  { term: "Pencil", desc: "Opens the toggle's edit panel: name, variable, style, needs, group and its output." },
  { term: "Add toggle / Add label", desc: "A new toggle, or a label that groups the toggles under it. Click a label's arrow to fold it." },
  { term: "context (out)", desc: "The Context with every toggle variable added, all internal." },
  { term: "toggle outputs", desc: "One BOOLEAN per toggle that has an output, at the right of its row. Up to 16." },
];

const edit = [
  { term: "Name", desc: "Shown on the row and on its output." },
  { term: "Variable", desc: "Gets true or false. It follows the name until you change it. Always internal, so it never prints in the prompt." },
  { term: "Style", desc: "Switch, Check, Buttons (two words of your own, like Day / Night) or Chip (a small chip with the name)." },
  { term: "Needs", desc: "Another toggle this one needs. While that one is off, this one is off too; it keeps your choice for when it comes back on." },
  { term: "Group", desc: "Which label it sits under." },
  { term: "BOOLEAN output", desc: "Show an output for switch nodes. Off for a toggle only rules read." },
];
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
        ratio="1720 / 760"
        caption="Three toggles and a Scene label. Use its own clothes needs LoRA character; Anime look has no output, only its variable."
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
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="Editing a toggle">
      <DocKeyList :items="edit" />
      <DocCallout variant="tip">
        Drag the grip to reorder. A label moves with its toggles. Moving a row never re-points a wire:
        each output stays with its toggle.
      </DocCallout>
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
          { id: 'wp-model-info', label: 'WP Model Info', icon: 'pi pi-microchip', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
