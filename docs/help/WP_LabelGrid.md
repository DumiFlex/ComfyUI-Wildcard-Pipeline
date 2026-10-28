# WP Label & Grid

Draws labels on images and lays them out in one labelled grid: compare runs, show a sweep as an XY plot, or just stamp each image with its seed. Takes one image, a batch, a list, or a list of batches (a Context Loop's frames). Labels are optional.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `images` | `IMAGE` | One image, a batch, a list, or a list of batches. |
| `labels` | `STRING` (list) | Optional. One entry per item, one line per image of its batch; one line covers the whole batch. The WP Image Filter's `labels` output fits here. One typed text whose lines match the image count is spread over all images. |

Everything else is set in the node's panel.

## Label

| Setting | Notes |
|---|---|
| Text | What each image shows. `{label}` = the incoming label (default), `{frame}` and `{image}` count from 1 per input item, `{index}` counts across all images, `{count}` = number of images. `\n` breaks a line. Empty = the incoming label. |
| Place | Above, below, left or right adds a strip beside the image (the image grows). **Over image** draws a see-through band over the top or bottom instead (same size). The last button draws no label. |
| Font | The default (Segoe UI / Arial / DejaVu Sans when found, else Pillow's built-in), fonts in the extension's `fonts/` folder, and your system fonts. Type to search. A font this machine lacks falls back to the default. |
| Size | Pixels. Empty = automatic (4.5% of the image width), so text stays readable at 512 px and at 4K. |
| Alignment | Left, centre, right. |
| Colour, strip / band | Click a swatch for the colour square, a hex box and (for the strip or band) an opacity; **None** drops the band. |

## Grid

Switch the grid off to only label the images. With it on, pick a **preset**; each one sets the layout and headers in one click, and you can change any of them after.

| Preset | What it does | Fits |
|---|---|---|
| Fit the run | Follows the images that come in: one batch fills a near-square sheet, up to six single images sit in one row, more fill a sheet, a list of batches gets one row per item. | Anything (the default). |
| Sheet | Every image in turn, filled into a near-square sheet (or the columns you set). | One batch, many single images. |
| Side by side | Every image in one row. | A few runs to compare. |
| Frame rows | One row per frame, its batch across. With the Image Filter's labels the rows are headed `#1`, `#2`, …. | A loop of batches. |
| Frame columns | The same, turned around. | A loop of batches. |
| XY plot | Rows and columns from two parts of the labels, each part's values as headers. | A sweep's labels. |
| No grid | Only the labelled images. | A single image. |

After a run the panel says what came in (for example `3 frames × 4 images`) and marks the preset that fits it, with **Use it** to switch.

| Setting | Notes |
|---|---|
| Layout | Fit the run, one row per frame, one column per frame, fill rows (with a column count, empty = near square), all in one row, all in one column. Label-part headers set the layout themselves. |
| Rows, Columns | No headers, typed (one header per line in the box that opens), or a label part. The list shows what each part held on the last run. |
| Title | Drawn above the grid. |
| Spacing | Gap between cells, edge around the grid, and cell width: empty keeps each image's size, a number scales every cell to that width (smaller grids, faster saves). |
| Colour, headers | Grid background, and the colour of headers and title. **Reset** puts spacing and these colours back. |

## Outputs

| Name | Type | Notes |
|---|---|---|
| `images` | `IMAGE` (list) | The labelled images in the shape they came in. A batch stays a batch: every image of it gets the same strip size. |
| `grid` | `IMAGE` | One grid image. A small empty image when the grid is off. |

The node also shows its result (the grid, or the labelled images) on the canvas, like Preview Image, so it can end a branch.

## XY plots from labels

A label can hold parts joined by ` · `. The Image Filter writes `#N · option · option · K`: the frame, the sweep options in the loop's axis order, then the image number when a frame has more than one. The **XY plot** preset picks the two parts that vary (here parts 2 and 3); set Rows and Columns by hand to choose others. The grid sorts the cells by those values, whatever order the images came in. The values become the headers and leave the cell labels, so the cells keep just `#N`. Two images on one spot (same options, another seed) repeat the row under the same header.

## Tips

- Without a labels input, use the text: `#{index}` numbers every image, `{frame}.{image}` shows where each came from.
- Mixed image sizes are centred in the largest cell on the background colour.
- Grids are capped at 16384 px on the longest side; very large grids are scaled down to fit. Use the cell width to keep them small.
- Wire `grid` into a Save Image node to keep it.
