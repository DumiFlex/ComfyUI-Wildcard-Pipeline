<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const looks = [
  { term: "Card", desc: "A panel with a coloured edge on the left. The title, the text and the docs button show on the canvas." },
  { term: "Sticky", desc: "The same panel, tinted with the colour." },
  { term: "Label", desc: "A small pill with the title only, sized to it. Hover it to see its text and docs link in a card; move onto the card to click them. Marks on the pill show that it has text (lines) or a docs link (book)." },
];

const edit = [
  { term: "Tone", desc: "Step (shows its number), Tip (lightbulb), Info (i) or Plain. Sets the colour." },
  { term: "Colour", desc: "Your own colour in place of the tone's. The undo arrow next to it goes back to the tone's colour." },
  { term: "Look", desc: "Card, Sticky or Label (above)." },
  { term: "Pinned", desc: "ComfyUI's own pin: a pinned note can't be moved or resized by accident. New notes start pinned." },
  { term: "Title", desc: "Shown in bold at the top, or on the pill of a Label." },
  { term: "Text", desc: "Markdown: **bold**, *italic*, lists and `$var`. Links show as text." },
  { term: "Docs link", desc: "A page of these docs. Shows as a button that opens it." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Note"
    icon="pi pi-bookmark"
    tone="node"
    node-id="WP_Note"
    blurb="A note that explains a workflow: a step, a tip or a label, with a link to these docs. It never runs."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Note</b> explains a workflow on the canvas. It looks like a panel, not a node: no title bar,
        no frame and no sockets, in the classic renderer and in Nodes 2.0, and its selection outline hugs
        the panel. It is left out of the prompt; its text is saved with the workflow.
      </p>
      <DocImage
        src="images/docs/wp-note.png"
        ratio="1720 / 644"
        caption="A Step card with a docs link, a Tip sticky, and a Label showing its hover card."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Numbered steps through a shared workflow',
          'A tip next to the node it is about, with its docs page one click away',
          'A small label over a group of nodes',
        ]"
        :better="[
          'A heading for a group of nodes: ComfyUI\'s own group title',
        ]"
      />
    </DocSection>

    <DocSection title="Looks">
      <DocKeyList :items="looks" />
    </DocSection>

    <DocSection title="Moving, sizing and editing">
      <p>
        Unpin a note to drag it like any node. A Card or Sticky resizes from its corner: the width is yours
        and the height follows the text. A Label sizes itself to its title. Double-click a note, press its
        pencil or press <b>Edit</b> on a label's hover card to open the editor; <b>Done</b> goes back to
        reading.
      </p>
      <DocKeyList :items="edit" />
      <DocCallout variant="tip">
        Add one from the node search: type <code>WP Note</code>. A new note opens in its editor.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'wp-label-grid', label: 'WP Label & Grid', icon: 'pi pi-th-large', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
