# WP Slider 2D

One XY pad: drag a point to set two numbers at once, X across and Y up. Each axis writes `$its_variable` like a WP Slider slider (the number, your text, or a word per range), `$its_variable.num` reads its number, and each axis has its own `INT` or `FLOAT` output, `x` and `y`.

<!-- video:start -->
<!-- video:end -->

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional Context to extend. Only nodes after this one see the pad's variables.
- **Pad**: Drag the point (or click anywhere on the pad) to set both numbers at once: X grows to the right, Y grows upward. Shift while dragging lands on finer values. With the point focused, the arrow keys move it one step (Shift: ten), Home and End put X at its ends.
- **X and Y**: Above the pad: each axis's name, its $variable (with the picked word in Words mode) and its number now.
- **Pencil (toolbar)**: Select the node and the pencil in ComfyUI's selection toolbar shows the edit strip: a pencil on each axis, the pad's shape and looks, Swap and Done.
- **Shape**: Edit strip. Square, Wide (3:2) or Tall (2:3): the pad's outline, so a Width × Height pad can look like the picture it sets.
- **Area, Lines, Dots**: Edit strip. Area shades the box from the bottom-left corner to the point (a picture size); Lines draws lines through the point; Dots sets how many guide dots per side (0 for none).
- **Swap**: Edit strip. Swaps the two axes' settings: X's go up, Y's go across. The outputs stay where they are.
- **context (out)** `context`: The Context with both axis variables added, and the numbers $name.num reads.
- **x / y (out)** `any`: Each axis's number, named after the axis: an INT or a FLOAT (by default an INT when the axis writes 0 decimals, else a FLOAT; the axis window can pick either), so it wires into width and height, cfg and steps, or any number input.

## Editing

- **Axis window**: An axis's pencil opens the same window as a WP Slider slider, with the axis drawn on top as a slider: Name, Variable, Range, Snap to step, Value (Number, Text or Words, with $name.num), Negative and Looks work the same way.
- **Output**: Auto, INT or FLOAT for the axis's output. An axis always has its output.
<!-- fields:end -->
