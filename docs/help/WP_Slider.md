# WP Slider

Several number sliders in one node. Each slider writes `$its_variable` (the number, your text, or the word of the range it is in), `$its_variable.num` always reads the number, and a slider can have an `INT` or `FLOAT` output.

<!-- video:start -->
<!-- video:end -->

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional Context to extend. Only nodes after this one see the slider variables.
- **Sliders**: Drag a slider's track or type the number in the box after it (its arrows step by the slider's step). Each slider writes its $variable when the run reaches the node: the number, your text, or the word of the range it is in. Hover a slider to see its whole name and what its variable gets now (a Text value with this node's $name.num filled in).
- **Pencil (toolbar)**: Select the node and the pencil in ComfyUI's selection toolbar opens the edit view: the grips to reorder, the row buttons, Add slider and Add label. Done goes back to the clean view, which shows only the sliders.
- **Pencil, globe, trash (row)**: Edit view only. The pencil opens the slider's own settings in a window with the row drawn on top as the node will show it; the globe keeps its variable internal (for rules only, never printed); the trash removes it. A new slider's variable shows in the Assembler.
- **Add slider / Add label**: A new slider (0 to 1, step 0.05), or a label that groups the sliders under it. Click a label's arrow to fold it; a folded label carries its sliders' output dots. Drag a slider's grip under a label to move it into that group; a dragged label takes its sliders along.
- **context (out)** `context`: The Context with every slider variable added, and the numbers $name.num reads.
- **number outputs** `any`: One output per slider that has one, at the right of its row: an INT or a FLOAT (by default an INT when the slider writes 0 decimals, else a FLOAT; the slider's window can pick either), so it wires into a sampler's steps or cfg, a LoRA strength or any number input. Up to 16.

## Editing

- **Name**: Shown on the row and on its output.
- **Variable**: What the slider writes. It follows the name until you change it. Show puts it under the name, with the picked word in Words mode.
- **Range**: Min, Max and Step of the track, and how many decimals the number is written with (0 writes a whole number, and an Auto output is then an INT). The value is rounded to those decimals. The fields keep each other in step: fewer decimals round the step (0 decimals turns a 0.05 step into 1) and the ends, a finer step adds decimals, and a min past the max moves the max with it.
- **Snap to step**: On (the default), a drag lands on the step: 0, 0.05, 0.1 … Hold Shift while dragging to land on any value the decimals can write (0.37); Ctrl (⌘ on a Mac) does that and skips the marks too. Off, every drag does that, and the arrows still move by the step.
- **Value: Number**: The variable gets the number as text, e.g. 0.45 or 28.
- **Value: Text**: The variable gets your text, which can read the slider's own number as $name.num and any other $variable: (intricate details:$detail.num) prints (intricate details:1.2). A text box like the Assembler's, with $ suggestions.
- **Value: Words**: Ranges, each with a word and an optional negative: the variable gets the word of the first range whose up to is at least the number; the last range catches the rest. 0 to 0.3 close-up, to 0.7 medium shot, the rest wide shot. The window marks the range the number is in now.
- **$name.num**: Reads the slider's number whatever the variable holds (like $name.bool for a toggle), in a template, a derivation or another text. For any other variable it reads the value when that already is a number, else nothing.
- **Negative**: Words to keep out of the image, carried by the slider's variable to an Assembler that prints it. In Words mode a word's own negative wins over this one.
- **Style**: How the slider is drawn. Row: the name, then a thin track. Bar: the whole row is the track, with the name inside it (a LoRA strength you drag anywhere on). Fader: an upright track with its value on top and the name under it; faders next to each other stand side by side, and their output dots line up on a list of their names at the right. The edit view draws every slider as a row or bar.
- **Looks**: An icon before the name and colours for the icon, the name and the track. Marks puts ticks along the track: where each Words range ends, else on the steps (at most 9, evenly spaced).
- **Group**: Which label it sits under. You can also drag the slider's grip under another label, or above the first one.
- **INT / FLOAT output**: Show an output with the number. Off for a new slider; leave it off for a slider only prompts and rules read. Auto makes it an INT at 0 decimals, else a FLOAT; INT sends the number rounded to a whole number, FLOAT sends it at the slider's decimals.
<!-- fields:end -->
