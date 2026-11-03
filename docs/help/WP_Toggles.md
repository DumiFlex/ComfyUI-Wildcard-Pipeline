# WP Toggles

Several on/off switches in one node. Each toggle writes `$its_variable` as `true` / `false` (always internal) and can have a `BOOLEAN` output.

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional Context to extend. Only nodes after this one see the toggle variables. It can also set toggles (see below).
- **Pencil (toolbar)**: Select the node and the indigo pencil in ComfyUI's selection toolbar opens the edit view: the mode, the grips to reorder, a pencil per row, Add toggle and Add label. Done goes back to the clean view, which shows only the switches.
- **Any on / Pick one**: Any on: every toggle is on or off by itself. Pick one: exactly one is on, like radio buttons.
- **writes (Pick one)**: Optional variable that also gets the picked toggle's value (or its name), so one rule can branch on it.
- **Pencil (row)**: Opens the toggle's edit panel: name, variable, style, needs, what off mutes or bypasses, group and its output.
- **Add toggle / Add label**: A new toggle, or a label that groups the toggles under it. Click a label's arrow to fold it.
- **control dots (in)**: A toggle that mutes or bypasses has a dot at the left of its row: wire the nodes it drives into it.
- **context (out)** `context`: The Context with every toggle variable added, all internal.
- **toggle outputs** `BOOLEAN`: One BOOLEAN per toggle that has an output, at the right of its row. Up to 16.

## Editing

- **Name**: Shown on the row and on its output.
- **Variable**: Gets true or false. It follows the name until you change it. Always internal, so it never prints in the prompt. Show puts it under the name in the clean view.
- **Style**: Switch, Check, Buttons (two words of your own, like Day / Night) or Chip (a small chip with the name).
- **Value (Pick one)**: What the picked variable gets when this toggle is picked, instead of its name. It can read $variables from upstream.
- **Needs**: Another toggle this one needs. While that one is off, this one is off too; it keeps your choice for when it comes back on.
- **When off**: Nothing, Mute or Bypass: what happens to the nodes wired into the row's dot (and to the canvas groups you pick) while the toggle is off. On, they run.
- **Invert**: Mute or bypass while the toggle is ON instead, for a node used only as a switchboard.
- **Canvas groups**: Groups on the canvas whose nodes When off also covers, by title. No wires needed.
- **Upstream can set it**: When the upstream Context holds this toggle's variable as a yes/no word (true, yes, on, 1, false, no, off, 0), that value sets the switch for the run.
- **Group**: Which label it sits under.
- **BOOLEAN output**: Show an output for switch nodes. Off for a toggle only rules read.
<!-- fields:end -->

## Toggles

- **Any on**: each toggle is on or off by itself. A toggle that **needs** another is off while that one is off, and keeps its own choice for when it is on again.
- **Pick one**: only one toggle is on: the one the upstream picked variable names (with **Upstream can pick**), else the first one upstream set on, else the first one you switched on. Optional **writes** variable gets the picked toggle's **Value**, or its name; internal unless **Show in prompt**.
- **When off**: Nothing, **Mute** or **Bypass** the nodes wired into the row's dot and any **Canvas groups** you pick, while the toggle is off (needs and Pick one count). Done on the canvas when the toggle flips.
- **Invert**: mute / bypass while the toggle is ON instead. An icon by the name shows a control is wired: coloured while it acts, dim while not; hover for the nodes.
- **Show** (by the variable): show the `$variable` under the name in the clean view.
- **Upstream can set it**: an upstream yes/no value for the toggle's variable (`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`) sets the switch for the run.
- **Clean and edit views**: select the node and the indigo pencil in ComfyUI's selection toolbar opens the edit view (mode, grips, row editors, Add toggle / Add label); **Done** goes back to the switches only.
- **Style**: switch, checkbox, two buttons (your own words, e.g. Day / Night) or chip.
- **Labels** group the toggles under them; fold one to hide them (their outputs gather on the label).

## Merge into WP Toggles

Select Boolean nodes, right-click, **Merge into WP Toggles**. A node merges when its only output is `BOOLEAN`, nothing is wired into it and it has one on/off value. Titles become names, values stay, wires move. One undo step.
