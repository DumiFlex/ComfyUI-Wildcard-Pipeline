# WP Slider 3D

Three numbers set together. The pad styles are an XY pad with a Z fader beside it; the Orbit style puts a camera or a light round the subject (angle round it, height, distance) and its Camera or Light words write one phrase like `front-left view, high angle, medium shot`. Each axis writes `$its_variable` like a WP Slider slider, `$its_variable.num` reads its number, and each axis has its own `INT` or `FLOAT` output, `x`, `y` and `z`.

<!-- video:start -->
<!-- video:end -->

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional Context to extend. Only nodes after this one see the node's variables.
- **Pad and Z fader**: The Pad, Size, Stick and Map styles: the XY pad of WP Slider 2D for X and Y, and an upright fader beside it for Z. A ring round the point grows with Z, and the mouse wheel over the pad moves Z one step.
- **Orbit**: The Orbit style: a camera or a light round the subject. The top view sets X, the angle round it (0 the front, 90 the right, ±180 the back), and how far from the middle sets Z, the distance; the side view sets Y, the height angle from below to straight above. The arrow keys turn it and move it out and in.
- **Mix**: The Mix style: a blend of three things, one at each corner of a triangle (X on top, Y bottom left, Z bottom right, named after the axes). The closer the point to a corner, the more of it, and the three shares add up to 100%. Each axis writes its share of its own range: with 0 to 1 a 50% share is 0.50, with 0 to 1.5 it is 0.75. The arrows move the point, Home makes the shares equal and 1, 2, 3 jump to a corner.
- **X, Y and Z**: Above the pad: each axis's name, its $variable (with the picked word in Words mode) and its number now. Hover one (or the phrase) for its whole name and what its variable gets. In the edit strip each has a pencil and a globe that keeps its variable internal (for rules only, never printed).
- **Phrase**: Under the axes once the Orbit words or the Mix example are on: one $variable that joins the three, like front-left view, high angle, medium shot, or (watercolor:0.40), (ink sketch:0.30), (oil painting:0.30). It is a Text value reading the axes' variables, so you can change its wording in its pencil.
- **Pencil (toolbar)**: Select the node and the pencil in ComfyUI's selection toolbar shows the edit strip: a pencil on each axis and the phrase, the style and its looks, and Done.
- **Style**: Edit strip. Pad, Size, Stick and Map work as in WP Slider 2D, with the Z fader beside the pad. Orbit draws the camera or light round the subject; picking it puts the camera words on the axes unless X already turns from -180 to 180. Mix draws the triangle; picking it puts the style example on the axes unless there is a phrase already.
- **Style example**: Edit strip, Mix. Three art styles (Watercolor, Ink sketch, Oil painting) as Number axes from 0 to 1, kept out of the prompt, and the phrase $style_mix that weights each one: (watercolor:0.40), (ink sketch:0.30), (oil painting:0.30). Rename the axes and reword the phrase for your own three. It replaces the axes and the phrase. S/M/L sets the triangle's size.
- **Look and Words**: Edit strip, Orbit. Look draws a camera or a light (an amber sun). Camera or Light puts that word set on all three axes: X the side (front, front-left … back), Y the height (eye level, high angle …; for a light low, high or overhead), Z the shot (close-up … wide shot; for a light soft, diffused or hard), and the phrase that joins them. It replaces the axes' ranges and words.
- **Shape, size, dots and looks**: Edit strip, pad styles. The same as WP Slider 2D: shape, S/M/L, dots and Snap to dots, Area, Colours and Lines. Swap swaps X and Y.
- **context (out)** `context`: The Context with the three axis variables (and the phrase) added, and the numbers $name.num reads.
- **x / y / z (out)** `any`: Each axis's number, named after the axis: an INT or a FLOAT (by default an INT when the axis writes 0 decimals, else a FLOAT; the axis window can pick either).

## Editing

- **Axis window**: An axis's pencil opens the same window as a WP Slider slider: Name, Variable, Range, Snap to step, Value (Number, Text or Words, with $name.num), Negative and Looks work the same way. Output picks Auto, INT or FLOAT; an axis always has its output. Match and Swap with another axis work as in WP Slider 2D.
- **Phrase window**: The phrase's pencil opens the same window with only what a phrase needs: its name, variable, wording (for example $view_side shot from $view_height) and negative. It is always text and has no output.
<!-- fields:end -->
