<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const looks = [
  { term: "Card", desc: "A panel with a coloured edge on the left. The title and the text show on the canvas." },
  { term: "Sticky", desc: "The same panel, tinted with the colour." },
  { term: "Label", desc: "A small pill with the title only, sized to it. Hover it to see its text and links in a card; move onto the card to click them. Marks on the pill show that it has text (lines) or a link (chain)." },
];

const edit = [
  { term: "Tone", desc: "Step (a numbered circle), Icon (pick any icon from the list next to it) or Plain (no badge)." },
  { term: "Colour", desc: "Presets that follow the theme (Accent, Tip, Info, Warning, Danger, Teal, Violet, Neutral), or any colour from the picker." },
  { term: "Look", desc: "Card, Sticky or Label (above)." },
  { term: "Pinned", desc: "ComfyUI's own pin: a pinned note can't be moved or resized by accident. New notes start pinned." },
  { term: "Title", desc: "Shown in bold at the top, or on the pill of a Label." },
  { term: "Text", desc: "Markdown, with the formatting bar below over it." },
];

const bar = [
  { term: "Bold, italic, strikethrough", desc: "Wraps the selection in **, * or ~~.", kbd: "Ctrl+B / Ctrl+I" },
  { term: "Code", desc: "Wraps it in backticks, for a $variable." },
  { term: "Lists and quote", desc: "Puts - , 1. or > before each selected line (press again to take it off)." },
  { term: "Link", desc: "A Docs page (type to find any page of these docs, then pick a section or the whole page) or a Web address, drawn as a Button with an icon or as a Text link. The selected text becomes the link's text.", kbd: "Ctrl+K" },
  { term: "Icon", desc: "Any PrimeIcons icon, searchable, in a colour or the text's own." },
  { term: "Preview (eye)", desc: "Shows the note as it will read." },
];

const syntax = [
  { term: "[Read more](https://example.com)", desc: "A link that opens in a new tab." },
  { term: "[Seeds](docs:seeds-and-loops)", desc: "A link to that page of these docs." },
  { term: "[The grid](docs:wp-label-grid#s-the-grid)", desc: "A link to one section of it." },
  { term: "[Start here](docs:quick-start){button pi-play}", desc: "The link drawn as a button with an icon. {button} alone has no icon." },
  { term: ":pi-heart:  :pi-heart:{#rrggbb}", desc: "An icon, optionally in a colour: a hex code like the custom colour field shows." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Note"
    icon="pi pi-bookmark"
    tone="node"
    node-id="WP_Note"
    blurb="A note that explains a workflow: a step, a warning or a label, with links into these docs. It never runs."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Note</b> explains a workflow on the canvas. It looks like a panel, not a node: no title bar,
        no frame and no sockets, in the classic renderer and in Nodes 2.0, and its selection outline hugs
        the panel. It is left out of the prompt; its text is saved with the workflow.
      </p>
      <DocImage
        src="images/docs/wp-note.png"
        ratio="1720 / 752"
        caption="A Step card with docs buttons, a Warning card with its own icon, a Tip sticky, and a Label showing its hover card."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Numbered steps through a shared workflow',
          'A warning or tip next to the node it is about, with its docs page one click away',
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
        Keys you type in the editor stay in the editor: Delete, Ctrl+Z and ComfyUI's other shortcuts don't
        reach the canvas.
      </DocCallout>
    </DocSection>

    <DocSection title="The formatting bar">
      <DocImage
        src="images/docs/wp-note-editor.png"
        ratio="1720 / 860"
        caption="The editor with the link panel open: a docs page found by typing, one of its sections, and a button with an icon."
      />
      <DocKeyList :items="bar" />
    </DocSection>

    <DocSection title="Links and icons in the text">
      <p>
        The bar writes these for you; you can also type them. A note can hold any number of links, anywhere
        in the text. Any other kind of link shows as plain text.
      </p>
      <DocKeyList :items="syntax" />
    </DocSection>

    <DocSection title="A note that is also a bookmark">
      <p>
        Turn on <b>Also a bookmark</b> at the bottom of the editor and the note joins the
        Bookmarks dock: pick where it lands on screen, its zoom and a
        shortcut, the same settings as a WP Bookmark, with the same clash check. A new one gets the next
        free shortcut. The dock shows it with the note's colour and icon, and a small bookmark mark on
        the note (its tooltip names the key) says it is one.
      </p>
      <DocImage
        src="images/docs/wp-note-bookmark.png"
        ratio="1720 / 860"
        caption="A note open in its editor with Also a bookmark on, a note card with its bookmark mark, and the dock listing both next to a WP Bookmark."
      />
      <DocCallout variant="tip">
        Unlike a WP Bookmark, a note can't be hidden on the canvas (it is there to be read), and muting
        it turns its shortcut off without fading it.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'wp-label-grid', label: 'WP Label & Grid', icon: 'pi pi-th-large', tone: 'node' },
          { id: 'wp-bookmark', label: 'WP Bookmark', icon: 'pi pi-bookmark', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
