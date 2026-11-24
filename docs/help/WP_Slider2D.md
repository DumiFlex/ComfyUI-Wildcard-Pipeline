# WP Slider 2D

One XY pad: drag a point to set two numbers at once, X across and Y up. Each axis writes `$its_variable` like a WP Slider slider (the number, your text, or a word per range), `$its_variable.num` reads its number, and each axis has its own `INT` or `FLOAT` output, `x` and `y`.

<!-- video:start -->
<!-- video:end -->

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional Context to extend. Only nodes after this one see the pad's variables.
- **Pad**: Drag the point (or click anywhere on the pad) to set both numbers at once: X grows to the right, Y grows upward. Shift while dragging lands on finer values. With the point focused, the arrow keys move it one step (Shift: ten), Home and End put X at its ends.
- **X and Y**: Above the pad: each axis's name, its $variable (with the picked word in Words mode) and its number now. Hover one for its whole name and what its variable gets. In the edit strip each has a pencil and a globe that keeps its variable internal (for rules only, never printed).
- **Pencil (toolbar)**: Select the node and the pencil in ComfyUI's selection toolbar shows the edit strip: a pencil on each axis, the pad's style, shape, size and looks, Swap and Done.
- **Style**: Edit strip. Pad is the plain pad. Size is for a picture size: the box from the bottom-left corner to the point is shaded, dashed lines mark 1:1, 4:3, 3:4, 16:9 and 9:16, and the corner reads Width × Height. Stick is round with zero in the middle (set both ranges from -1 to 1) and keeps the point inside the circle. Map writes each Words axis's words on the pad as sections, each in its own soft colour, the one the point is in highlighted.
- **Shape and size**: Edit strip. Square, Wide (3:2), Tall (2:3) or Auto, which follows the two ranges (0–1024 across and 0–1344 up is a 3:4 pad). S, M or L sets how wide the pad is; L fills the node.
- **Dots and Snap to dots**: Edit strip. Dots empty (Auto) puts a dot on every step of each axis, spread over the steps past 16; a number puts up to that many per side, always on steps; 0 hides them. Snap to dots makes the point land on a dot (or an edge), and the arrow keys walk dot to dot.
- **Area, Colours, Lines**: Edit strip. Area shades the box from the bottom-left corner to the point (Size always does); Colours (Map style, on by default) gives each word section its own soft colour, the point's one a little stronger; Lines draws lines through the point.
- **Swap**: Edit strip. Swaps the two axes' settings: X's go up, Y's go across. The outputs stay where they are.
- **context (out)** `context`: The Context with both axis variables added, and the numbers $name.num reads.
- **x / y (out)** `any`: Each axis's number, named after the axis: an INT or a FLOAT (by default an INT when the axis writes 0 decimals, else a FLOAT; the axis window can pick either), so it wires into width and height, cfg and steps, or any number input.

## Editing

- **Axis window**: An axis's pencil opens the same window as a WP Slider slider, with the axis drawn on top as a slider: Name, Variable, Range, Snap to step, Value (Number, Text or Words, with $name.num), Negative and Looks work the same way.
- **Output**: Auto, INT or FLOAT for the axis's output. An axis always has its output.
<!-- fields:end -->
