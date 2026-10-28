<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const ports = [
  { term: "images", desc: "One image, a batch, a list, or a list of batches (a Context Loop's frames). Required." },
  { term: "labels", desc: "Optional text, one entry per item and one line per image of its batch. One line covers the whole batch. The Image Filter's labels output fits straight in. One typed text with a line per image works too." },
  { term: "images (out)", desc: "The labelled images, in the shape they came in. A batch stays a batch." },
  { term: "grid (out)", desc: "Every image in one labelled grid. The node also shows it on the canvas, so it can end a branch." },
];

const label = [
  { term: "Text", desc: "What each image shows. {label} is the incoming label (the default), {frame} and {image} count from 1 per input item, {index} counts across all images, {count} is how many there are. \\n breaks a line." },
  { term: "Place", desc: "Above, below, left or right adds a strip beside the image. Over image draws a see-through band over the top or bottom and keeps the size. The last button draws no label." },
  { term: "Font and size", desc: "Your system fonts plus any you drop into the extension's fonts folder; type to search. An empty size is automatic: a share of the image width, so labels read the same at 512 px and at 4K." },
  { term: "Colours", desc: "Click a swatch for the colour square and a hex box. The strip or band also has an opacity, and None drops it." },
];

const presets = [
  { term: "Fit the run", desc: "The default. Follows what comes in: one batch fills a sheet, a few single images sit in one row, a list of batches gets one row per frame." },
  { term: "Sheet", desc: "Every image in turn, filled into a near-square sheet, or the columns you set." },
  { term: "Side by side", desc: "Every image in one row, for comparing a few runs." },
  { term: "Frame rows / Frame columns", desc: "One row (or column) per frame of a loop, its batch across. With the Image Filter's labels they are headed #1, #2, …" },
  { term: "XY plot", desc: "Rows and columns from the two label parts that vary, each part's values as headers." },
  { term: "No grid", desc: "Only label the images." },
];

const grid = [
  { term: "Layout", desc: "Fit the run, one row or column per frame, fill rows (with a column count), all in one row, all in one column. Label-part headers set the layout themselves." },
  { term: "Rows, Columns", desc: "No headers, typed (one header per line in the box that opens), or a label part. The list shows what each part held on the last run." },
  { term: "Title, Spacing", desc: "A line of text above the grid; the gap between cells, the edge around the grid, and the cell width (empty keeps image sizes, a number scales every cell to it)." },
  { term: "Colours", desc: "The grid's background and the colour of headers and title. Reset puts spacing and these back." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Label & Grid"
    icon="pi pi-th-large"
    tone="node"
    node-id="WP_LabelGrid"
    blurb="Put labels on images and lay them out in one labelled grid, from a single image up to a whole sweep."
  >
    <DocSection title="What it's for">
      <p>
        Comparing runs side by side is easier when every image says what it is.
        <b>WP Label &amp; Grid</b> writes a label on each image and, if you like, lays them all out
        in one grid with row and column headers. It takes whatever a workflow produces: one image,
        a batch, a list, or a Context Loop's frames of batches.
      </p>
      <DocUseWhen
        :good="[
          'Turning a sweep into an XY plot with headers',
          'Stamping each image with its frame, seed or settings',
          'One contact sheet of a whole loop',
        ]"
        :better="[
          'Picking images to keep: that is the WP Image Filter',
        ]"
      />
    </DocSection>

    <DocSection title="Set it up">
      <DocFlow figure="wp-label-grid-flow"
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'a sweep', tone: 'node' },
          { icon: 'pi pi-filter', name: 'WP Image Filter', sub: 'images + labels', tone: 'node' },
          { icon: 'pi pi-th-large', name: 'WP Label & Grid', sub: 'labelled grid', tone: 'node' },
        ]"
        :arrows="['frames', 'images, labels']"
        caption="Wire the Image Filter's images and labels into the node. The labels name each frame's sweep options, so the grid can sort by them."
      />
      <ol style="margin-top: 14px;">
        <li>Wire your images into <code>images</code>. Labels are optional.</li>
        <li>Pick where the label goes in the node's panel.</li>
        <li>Run once. The panel says what came in and marks the grid preset that fits it;
          click <b>Use it</b>, or pick another preset.</li>
      </ol>
      <DocImage
        src="images/docs/wp-label-grid.png"
        ratio="1720 / 860"
        caption="A 3 × 3 sweep with the XY plot preset: rows from label part 2, columns from label part 3, the cells keep their #N on a see-through band."
      />
    </DocSection>

    <DocSection title="Ports">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Labels">
      <DocKeyList :items="label" />
      <DocCallout variant="tip">
        Without a labels input the template still works: <code>#{index}</code> numbers every image.
      </DocCallout>
    </DocSection>

    <DocSection title="Grid presets">
      <p>
        Images can come as one batch, a list, or a list of batches, and each wants a different grid.
        A preset sets the layout and headers in one click; change anything after.
      </p>
      <DocKeyList :items="presets" />
    </DocSection>

    <DocSection title="The grid">
      <DocKeyList :items="grid" />
      <p>
        A label can hold parts joined by <code> · </code>. The Image Filter writes
        <code>#3 · red · pencil</code>: the frame, then the sweep options in the loop's order, then the
        image number when a frame has more than one. With <b>Rows from label part 2</b> and
        <b>Columns from label part 3</b> (what the XY plot preset picks here), every image lands under
        its options whatever order it came in, the options become the headers, and the cells keep
        just <code>#3</code>. Two images with the same options (another seed) repeat the row.
      </p>
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li>Long labels wrap to the image width; past three lines they end with "…".</li>
        <li>Images of different sizes are centred in the largest cell.</li>
        <li>A font the machine doesn't have (a workflow from someone else) falls back to the default.</li>
        <li>Grids are capped at 16384 px on the longest side. Use the cell width to keep them small.</li>
        <li>Wire <code>grid</code> into a Save Image node to keep it.</li>
      </ul>
    </DocSection>

    <CrossLinks
      :links="[
        { id: 'wp-image-filter', label: 'WP Image Filter', icon: 'pi pi-filter', tone: 'node' },
        { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
        { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
      ]"
    />
  </DocPage>
</template>
