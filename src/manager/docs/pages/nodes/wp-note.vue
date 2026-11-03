<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const looks = [
  { term: "Card", desc: "A panel with a coloured edge on the left. The title and the text show on the canvas." },
  { term: "Sticky", desc: "The same panel, tinted with the colour." },
  { term: "Label", desc: "A small pill with the title only, sized to it. Hover it to see its text and links in a card; move onto the card to click them. Marks on the pill show that it has text (lines) or a link (chain)." },
];

const syntax = [
  { term: "[Read more](https://example.com)", desc: "A link that opens in a new tab." },
  { term: "[Seeds](docs:seeds-and-loops)", desc: "A link to that page of these docs." },
  { term: "[The grid](docs:wp-label-grid#s-the-grid)", desc: "A link to one section of it." },
  { term: "[Start here](docs:quick-start){button pi-play}", desc: "The link drawn as a button with an icon. {button} alone has no icon." },
  { term: "{button pi-play #rrggbb}  [Read more](https://example.com){#rrggbb}", desc: "A button or a text link in its own colour, a hex code like the colour field shows. Without one it takes the note's." },
  { term: "[Add the pack](wp:library){button pi-download}", desc: "A button that adds this workflow's bundles and modules to your library, after a review. Always a button." },
  { term: "[Add the Scene lists](wp:library#node-12){button}", desc: "The same for one WP Context only (its node id; inside a subgraph the editor writes the subgraph's id too)." },
  { term: "[Get the pack](wp:community/owner/pack)", desc: "Opens that published pack in the manager's Community tab, where it installs." },
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
        and the height follows the text. A Label sizes itself to its title. Double-click a note, press the
        indigo pencil in ComfyUI's selection toolbar while it is selected, or press <b>Edit</b> on a label's hover card to open the editor; <b>Done</b> goes back to
        reading.
      </p>
      <DocFields node="WP_Note" group="edit" />
      <Banner tone="info" note>
        Keys you type in the editor stay in the editor: Delete, Ctrl+Z and ComfyUI's other shortcuts don't
        reach the canvas.
      </Banner>
    </DocSection>

    <DocSection title="The formatting bar">
      <DocImage
        src="images/docs/wp-note-editor.png"
        ratio="1720 / 860"
        caption="The editor with the link panel open: a docs page found by typing, one of its sections, and a button with an icon."
      />
      <DocFields node="WP_Note" group="bar" />
    </DocSection>

    <DocSection title="Links and icons in the text">
      <p>
        The bar writes these for you; you can also type them. A note can hold any number of links, anywhere
        in the text. Any other kind of link shows as plain text.
      </p>
      <DocKeyList :items="syntax" />
    </DocSection>

    <DocSection title="An add-to-library button">
      <p>
        A note can carry a button that puts the bundles and modules of the workflow into your library, so
        someone who opens a shared workflow can keep its lists in one press. In the link panel pick
        <b>Library</b>, then <b>This workflow</b> or <b>One WP Context</b> (a list of the Contexts on the
        canvas). The example workflows' <b>Start here</b> notes have one.
      </p>
      <DocImage
        src="images/docs/wp-note-library.png"
        ratio="1720 / 860"
        caption="The Start here note's button pressed: the review lists the workflow's six bundles and fifteen modules before anything is added."
      />
      <p>
        The button's tooltip says what it would add ("Add 4 bundles and 12 modules from this workflow to
        your library"); when everything is there already it says so and stays off. Pressing it opens a
        review that lists every item. New ones go in under their own id. For an item your library already
        holds with other content you choose <b>Use mine</b> (the default: nothing changes), <b>Replace</b>
        or <b>Keep both</b> (it goes in as a copy and this workflow points at the copy). An id that belongs
        to another kind of item offers only <b>Keep both</b> or <b>Leave out</b>.
      </p>
      <p>
        <b>Add</b> installs it all in one step, with the same checks as the Import tab: if one item is
        refused, nothing goes in. The EXAMPLE and MISSING marks clear on every Context, and the message
        that follows has <b>Undo</b>, which takes it all back out of the library.
      </p>
      <Banner tone="info" note>
        Nothing is added until you press Add in the review, and the button only ever reads the
        workflow's own rows: no downloads, files or code. A shared workflow's button could be worded to
        mislead; the review lists exactly what it adds.
      </Banner>
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
      <Banner tone="info" note>
        Unlike a WP Bookmark, a note can't be hidden on the canvas (it is there to be read), and muting
        it turns its shortcut off without fading it.
      </Banner>
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
