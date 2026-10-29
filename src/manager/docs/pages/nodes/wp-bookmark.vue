<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const controls = [
  { term: "Icon, colour, name", desc: "How the bookmark shows in the dock. The colour also tints the node's title bar." },
  { term: "Go", desc: "Jump now." },
  { term: "Lands at", desc: "A 3×3 grid: the corner, edge or centre of the screen the bookmark goes to, 24 px in from the edge (beside the dock while it's open)." },
  { term: "Zoom", desc: "Set jumps to that zoom (0.1–10×; the magnifier takes the zoom you're at). Keep current leaves it alone." },
  { term: "Shortcut", desc: "Record, then press the keys (Esc cancels, Backspace clears). The bolt picks a free one." },
  { term: "Show on canvas", desc: "Off hides the node: not drawn, not clickable, not selectable. The dock's eye shows it again." },
];

const clashes = [
  { term: "Refused", desc: "Keys the browser keeps: Ctrl+T, Ctrl+W, Ctrl+1–9, F5, F11 and the like." },
  { term: "Warning", desc: "A ComfyUI shortcut (yours from Settings › Keybinding included), another extension's, another WP Bookmark's, or an rgthree bookmark's in the same workflow." },
  { term: "Note", desc: "No Ctrl or Alt: it fires whenever the canvas has focus, never while you type." },
];

const dock = [
  { term: "Row", desc: "Click to jump. Number, icon, name and shortcut; a mark for one hidden on the canvas or inside a subgraph, OFF for a muted one." },
  { term: "Back", desc: "Return to where you were before the last jump." },
  { term: "↑ / ↓", desc: "Step through the bookmarks that are on, in dock order." },
  { term: "Pencil", desc: "Edit mode: drag the grips to reorder, the eye shows or hides a bookmark on the canvas, the arrow moves the dock to the other side, and Bookmark this view adds one at the top-left of the screen with the zoom you're at. Done goes back." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Bookmark"
    icon="pi pi-bookmark"
    tone="node"
    node-id="WP_Bookmark"
    blurb="Mark a spot on the canvas and jump back to it with a shortcut or from the Bookmarks dock."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Bookmark</b> marks a place in a big workflow. Press its shortcut, or click it in the
        <b>Bookmarks</b> dock, and the canvas glides there: the bookmark lands at the corner, edge or
        centre of the screen you picked, at the zoom you picked. It never runs and is left out of the
        prompt; its settings are saved with the workflow.
      </p>
      <DocImage
        src="images/docs/wp-bookmark.png"
        ratio="1720 / 752"
        caption="Sampler in its one-line read view; Prompts open in the editor, where the clash check flags Ctrl+S."
      />
    </DocSection>

    <DocSection title="Notes as bookmarks">
      <p>
        A <b>WP Note</b> can be a bookmark too: turn on <b>Also a bookmark</b> in its editor. It gets the
        same Lands at, Zoom and Shortcut settings and shows in the dock in the note's colour, but it never
        hides on the canvas, and muting it turns its shortcut off without fading it.
      </p>
    </DocSection>

    <DocSection title="Read view and editor">
      <p>
        A saved bookmark shows one line: its icon, where it lands and its zoom, its shortcut (with a
        warning mark when something else uses it), <b>Go</b> and a pencil. The pencil, or a
        double-click on the node, opens the editor; <b>Done</b> closes it. A new bookmark opens in the
        editor.
      </p>
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Jumping between the prompt, the sampler and the outputs of a large graph',
          'A tour of a shared workflow: step through it with Next',
          'Getting back to the same view and zoom every time',
        ]"
        :better="[
          'Explaining a step to someone: a WP Note',
        ]"
      />
    </DocSection>

    <DocSection title="Settings">
      <DocKeyList :items="controls" />
      <DocCallout variant="tip">
        Muting or bypassing a bookmark turns it off: its shortcut does nothing and the dock greys it.
      </DocCallout>
    </DocSection>

    <DocSection title="Shortcut clashes">
      <p>While you set a shortcut, the node lists who else uses it.</p>
      <DocKeyList :items="clashes" />
      <DocCallout variant="warn">
        Extensions that read keys themselves can't be seen in advance. If one takes the key first,
        the bookmark doesn't jump and a toast names the combo once, so you can pick another.
      </DocCallout>
    </DocSection>

    <DocSection title="The Bookmarks dock">
      <p>
        The bookmark button in the top bar shows or hides the dock. It also opens by itself in a
        workflow with bookmarks, unless you closed it.
      </p>
      <DocImage
        src="images/docs/wp-bookmark-dock.png"
        ratio="1720 / 752"
        caption="The dock in view mode: click a row to jump. Its pencil opens edit mode, where the eye brings back a hidden bookmark."
      />
      <DocKeyList :items="dock" />
      <DocCallout variant="tip">
        Next, Previous, Back, Bookmark this view and the dock toggle are commands without keys: bind
        them in Settings › Keybinding.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-note', label: 'WP Note', icon: 'pi pi-bookmark', tone: 'node' },
          { id: 'wp-node-group', label: 'WP Node Group', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-toggles', label: 'WP Toggles', icon: 'pi pi-check-square', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
