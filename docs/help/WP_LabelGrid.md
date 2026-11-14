# WP Label & Grid

Draws labels on images and lays them out in one labelled grid: compare runs, show a sweep as an XY plot, or just stamp each image with its seed. Takes one image, a batch, a list, or a list of batches (a Context Loop's frames). Labels are optional.

<!-- video:start -->
▶ **Video:** [WP Label & Grid in depth: XY plots and contact sheets](https://youtu.be/T_-Dbi0qqD0) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## Inputs and outputs

- **images** `IMAGE`: One image, a batch, a list, or a list of batches (a Context Loop's frames). Required.
- **labels** `STRING`: Optional text, one entry per item and one line per image of its batch. One line covers the whole batch, and a single one-line label covers every image of every item. The Image Filter's labels output fits straight in. One typed text with a line per image works too, spread over the images in order. When the lines and images don't match, a warning on the node says how many images got no line or how many lines were left over.
- **label_text** `STRING`: Optional text from another node for what each image shows; {label}, {index} and the other tokens still work. A list gives one text per item, the last one covering any item past it.
- **title** `STRING`: Optional text from another node for the grid title. Once wired, the panel's Title box shows that it comes from the wire.
- **row_headers, column_headers** `STRING`: Optional text from another node, one header per line (a list gives one header per entry). Wiring one sets that side to typed headers and replaces its dropdown on the panel. Like a built-in widget's, each text input's dot sits beside the field it feeds and shows when you hover that field or wire it.
- **images (out)** `IMAGE`: The labelled images, in the shape they came in. A batch stays a batch.
- **grid (out)** `IMAGE`: Every image in one labelled grid. The node also shows it on the canvas, so it can end a branch.

## Label

- **Text**: What each image shows. {label} is the incoming label (the default), {frame} and {image} count from 1 per input item, {index} counts across all images, {count} is how many there are. \n breaks a line.
- **Place**: Above, below, left or right adds a strip beside the image. Over image draws a see-through band over that edge instead and keeps the size, on any side. The last button draws no label.
- **Text direction**: Left and right only: horizontal text, or vertical text turned along the edge (reading upwards on the left, downwards on the right), which keeps the strip thin.
- **Font and size**: Your system fonts plus any you drop into the extension's fonts folder; type to search. An empty size is automatic: a share of the image width, so labels read the same at 512 px and at 4K.
- **Colours**: Click a swatch for the colour square and a hex box. The strip or band also has an opacity, and None drops it.

## Grid

- **Layout**: Fit the run, one row or column per frame, fill rows (with a column count), all in one row, all in one column. Label-part headers set the layout themselves.
- **Rows, Columns**: No headers, typed (one header per line in the box that opens), or a label part. The list shows what each part held on the last run. An image whose label lacks the part goes to a last row or column headed (no label), and the node warns when typed headers are fewer or more than the rows or columns.
- **Title, Spacing**: A line of text above the grid; the gap between cells, the edge around the grid, and the cell width (empty keeps image sizes, a number scales every cell to it).
- **Colours**: The grid's background and the colour of headers and title. Reset puts spacing and these back.
<!-- fields:end -->

## XY plots from labels

A label can hold parts joined by ` · `. The Image Filter writes `#N · option · option · K`: the frame, the sweep options in the loop's axis order, then the image number when a frame has more than one. The **XY plot** preset picks the two parts that vary (here parts 2 and 3); set Rows and Columns by hand to choose others. The grid sorts the cells by those values, whatever order the images came in. The values become the headers and leave the cell labels, so the cells keep just `#N`. Two images on one spot (same options, another seed) repeat the row under the same header.

## Tips

- Without a labels input, use the text: `#{index}` numbers every image, `{frame}.{image}` shows where each came from.
- Mixed image sizes are centred in the largest cell on the background colour.
- Grids are capped at 16384 px on the longest side; very large grids are scaled down to fit. Use the cell width to keep them small.
- Wire `grid` into a Save Image node to keep it.
