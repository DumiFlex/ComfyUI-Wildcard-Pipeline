<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const controls = [
  { term: "Icon, colour, name", desc: "The icon opens the full icon list. The colour marks the pill and its dock row." },
  { term: "Lands at", desc: "A 3×3 grid: the corner, edge or centre of the free part of the screen (what ComfyUI's toolbar, the open side panel and the bottom panel leave, following them as they open and close), 24 px in. A jump that would land under the dock, the minimap or the zoom controls moves just enough to clear them all (the dock only while its Land clear of the dock switch is on). It lands in the same place however often you press the key, selected or not, and a toast showing at the time doesn't move it." },
  { term: "Use this view", desc: "Lands on the view on screen now, at its zoom, instead of a grid spot." },
  { term: "Zoom", desc: "Set jumps to that zoom (0.1–10×; the magnifier takes the zoom you're at). Keep current leaves it alone." },
  { term: "Shortcut", desc: "Record, then press the keys (Esc cancels, Backspace clears). The bolt picks a free one, a new one on each press." },
  { term: "Show on canvas", desc: "Off hides the node when you press Done: not drawn, not clickable, not selectable. The dock's eye shows it again." },
  { term: "Pinned", desc: "ComfyUI's own pin: a pinned bookmark can't be moved by accident." },
  { term: "Go", desc: "Tries the jump." },
];

const clashes = [
  { term: "Refused", desc: "Keys the browser keeps: Ctrl+T, Ctrl+W, Ctrl+1–9, F5, F11 and the like." },
  { term: "Warning", desc: "A ComfyUI shortcut (yours from Settings › Keybinding included), another extension's, another WP Bookmark's, or an rgthree bookmark's in the same workflow." },
  { term: "Note", desc: "No Ctrl or Alt: it fires whenever the canvas has focus, never while you type." },
];

const dock = [
  { term: "Row", desc: "Click to jump. Number (a Step note's in its circle), icon, name and shortcut; a mark for one hidden on the canvas or inside a subgraph, OFF for a muted one." },
  { term: "Back", desc: "Return to where you were before the last jump." },
  { term: "↑ / ↓", desc: "Step through the bookmarks that are on, in dock order." },
  { term: "Pencil", desc: "Edit mode: drag the dock by its header and it snaps to the nearest spot of a 3×3 grid on the free canvas (a dashed outline shows where); drag the grips to reorder, the eye shows or hides a bookmark on the canvas, and Bookmark this view adds one. Land clear of the dock (on by default) moves a jump out from under the dock; off, bookmarks land where they would without it, behind the see-through dock. Done goes back." },
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
        caption="Sampler as a pill on the canvas; Prompts open in its editor, where the clash check flags Ctrl+S."
      />
    </DocSection>

    <DocSection title="Notes as bookmarks">
      <p>
        A <b>WP Note</b> can be a bookmark too: turn on <b>Also a bookmark</b> in its editor. It gets the
        same Lands at, Zoom and Shortcut settings and shows in the dock in the note's colour, but it never
        hides on the canvas, and muting it turns its shortcut off without fading it.
      </p>
    </DocSection>

    <DocSection title="On the canvas">
      <p>
        A bookmark has no node frame and can't be resized: it is a small pill with its icon, name and shortcut (a warning
        mark when something else uses the key, a pin when it is pinned). Hover it for where it lands.
        A double-click, or the indigo pencil in ComfyUI's selection toolbar while it is selected, opens the editor, and <b>Done</b>
        closes it. A new bookmark opens in the editor.
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
      <Banner tone="info" note>
        Muting or bypassing a bookmark turns it off: its shortcut does nothing and the dock greys it.
      </Banner>
    </DocSection>

    <DocSection title="Shortcut clashes">
      <p>While you set a shortcut, the node lists who else uses it.</p>
      <DocKeyList :items="clashes" />
      <p>
        Extensions that read keys themselves declare nothing a keymap could show, so the node also
        asks the page: when you record a key or press the bolt, it sends a pretend key press and
        watches for anything that claims it. A key something answers is listed as taken and the bolt
        skips it. The pretend press stops a handler at the moment it claims the key, so nothing runs.
      </p>
      <Banner tone="warn" note>
        A handler that acts without claiming the key can't be seen this way. If an extension still
        takes the key first, the bookmark doesn't jump and a toast names the combo once, so you can
        pick another. The key is remembered: the clash check marks it from then on and the bolt never
        suggests it.
      </Banner>
    </DocSection>

    <DocSection title="The Bookmarks dock">
      <p>
        The bookmark button in the top bar shows or hides the dock. It also opens by itself in a
        workflow with bookmarks, unless you closed it. It sits in the free part of the canvas, clear
        of the side panel, the bottom panel, the minimap and the zoom controls, and moves when they
        open or close. It is see-through until you point at it (more so when folded).
      </p>
      <DocImage
        src="images/docs/wp-bookmark-dock.png"
        ratio="1720 / 752"
        caption="The dock in view mode: click a row to jump. Its pencil opens edit mode, where the eye brings back a hidden bookmark."
      />
      <DocKeyList :items="dock" />
      <Banner tone="info" note>
        Next, Previous, Back, Bookmark this view and the dock toggle are commands without keys: bind
        them in Settings › Keybinding.
      </Banner>
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
