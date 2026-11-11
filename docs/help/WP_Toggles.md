# WP Toggles

Several on/off switches in one node. Each toggle writes `$its_variable` as `true` / `false` (internal unless you turn off its globe) and can have a `BOOLEAN` output.

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional Context to extend. Only nodes after this one see the toggle variables. It can also set toggles (see below).
- **Pencil (toolbar)**: Select the node and the indigo pencil in ComfyUI's selection toolbar opens the edit view: the mode, the Pick one options, the grips to reorder, the row buttons, Add toggle and Add label. Done goes back to the clean view, which shows only the switches.
- **Any on / Pick one**: Any on: every toggle is on or off by itself. Pick one: exactly one is on, like radio buttons.
- **writes (Pick one)**: Optional variable that also gets the picked toggle's value (or its name), so one rule can branch on it.
- **Globe (row)**: Edit view only. On (the default) keeps the toggle's variable internal: rules read it, the Assembler doesn't offer it and it never prints. Turn it off to use the variable in a prompt. Same in Any on and Pick one.
- **Show in Assembler (Pick one)**: The picked variable shows in the Assembler and can print in the prompt. Off, it is internal.
- **Style (Pick one)**: How every row looks in Pick one: Radio (a round dot, the default), Chip (the name across the row, lit when picked), Switch or Check. Turning one on turns the others off.
- **Pencil, globe, trash (row)**: Each row in the edit view has three buttons, like a module on a Context node: the pencil opens the toggle's own settings in a window (name, variable, looks, style, needs, what off mutes or bypasses, group and its output) with the row drawn on top as the node will show it; the globe keeps its variable internal; the trash removes it.
- **Add toggle / Add label**: A new toggle, or a label that groups the toggles under it. Click a label's arrow to fold it; its icon and colour buttons pick any icon and any colour. Drag a toggle's grip under a label to move it into that group; a dragged label takes its toggles along.
- **control dots (in)**: A toggle that mutes or bypasses has a dot at the left of its row: wire the nodes it drives into it.
- **context (out)** `context`: The Context with every toggle variable added. Internal ones (the globe) are for rules only; the rest show in the Assembler.
- **toggle outputs** `BOOLEAN`: One BOOLEAN per toggle that has an output, at the right of its row. Up to 16.

## Editing

- **Name**: Shown on the row and on its output. A Chip shows Name · $variable (the variable while Show is on). A name colour also colours its variable.
- **Variable**: Gets true or false. It follows the name until you change it. Internal until you turn off the row's globe. Show puts it under the name, or after it on a Chip.
- **Looks**: An icon before the name, and colours for the icon, the name and the control (switch, check, radio, chip or buttons), so Day can be yellow and Night blue. None keeps the theme's colour.
- **Style**: Switch, Check, Buttons (two words of your own, like Day / Night) or Chip (a small chip with the name). Any on only: in Pick one the Style in the top bar sets every row's look.
- **Value (Pick one)**: What the picked variable gets when this toggle is picked, instead of its name. A text box like the Assembler's: $ lists every variable upstream (Context Injector ones included) and the toggles' own, and tag, LoRA and embedding autocomplete work when they are on. A $name nothing upstream sets is flagged under the box and in WP Debug. Inline {a|b} picks need a seed, so they print as written; roll them in a wildcard instead. Drag the corner to make it taller.
- **Negative (Pick one)**: Words to keep out of the image while this toggle is picked. They go with the picked variable, so an Assembler that prints it sends them to its negative output, like a wildcard option's negative. It can read $variables; a pick without one clears what the variable carried.
- **Needs**: Any on only. Another toggle this one needs. While that one is off, this one is off too; it keeps your choice for when it comes back on.
- **When off**: Nothing, Mute or Bypass: what happens to the nodes wired into the row's dot (and to the canvas groups you pick) while the toggle is off. On, they run. When several toggles drive one node, off wins: it runs only while all of them let it (Mute beats Bypass).
- **Invert**: Mute or bypass while the toggle is ON instead, for a node used only as a switchboard.
- **Canvas groups**: Groups on the canvas whose nodes When off also covers, by title. No wires needed.
- **Upstream can set it**: When the upstream Context holds this toggle's variable as a yes/no word (true, yes, on, 1, false, no, off, 0), that value sets the switch for the run.
- **Group**: Which label it sits under. You can also drag the toggle's grip under another label, or above the first one.
- **BOOLEAN output**: Show an output for switch nodes. Off for a toggle only rules read.
<!-- fields:end -->

## Toggles

- **Any on**: each toggle is on or off by itself. A toggle that **needs** another is off while that one is off, and keeps its own choice for when it is on again.
- **Pick one**: only one toggle is on: the one the upstream picked variable names (with **Upstream can pick**), else the first one upstream set on, else the first one you switched on. Optional **writes** variable gets the picked toggle's **Value**, or its name; internal unless **Show in Assembler**. Its **Style** (Radio, Chip, Switch, Check) sets every row's look.
- **When off**: Nothing, **Mute** or **Bypass** the nodes wired into the row's dot and any **Canvas groups** you pick, while the toggle is off (needs and Pick one count). Done on the canvas when the toggle flips.
- **Invert**: mute / bypass while the toggle is ON instead. An icon by the name shows a control is wired: coloured while it acts, dim while not; hover for the nodes.
- **Show** (by the variable): show the `$variable` under the name in the clean view.
- **Upstream can set it**: an upstream yes/no value for the toggle's variable (`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`) sets the switch for the run.
- **Clean and edit views**: select the node and the indigo pencil in ComfyUI's selection toolbar opens the edit view (mode, grips, row editors, Add toggle / Add label); **Done** goes back to the switches only.
- **Style**: switch, checkbox, two buttons (your own words, e.g. Day / Night) or chip.
- **Labels** group the toggles under them; fold one to hide them (their outputs gather on the label).

## Merge into WP Toggles

Select Boolean nodes, right-click, **Merge into WP Toggles**. A node merges when its only output is `BOOLEAN`, nothing is wired into it and it has one on/off value. Titles become names, values stay, wires move. One undo step.
