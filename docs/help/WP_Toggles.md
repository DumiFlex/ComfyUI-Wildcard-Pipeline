# WP Toggles

Several on/off switches in one node. Each toggle writes `$its_variable` as `true` / `false` (always internal) and can have a `BOOLEAN` output.

## Inputs and outputs

| Name | Type | Notes |
|---|---|---|
| `upstream` | context | Optional. The Context to extend. Can set toggles (see below). |
| control dots | any | One at the left of each toggle that mutes or bypasses: wire the nodes it drives in (or a WP Node Group). Never sent to the run. |
| `context` (out) | context | Upstream plus every toggle variable. |
| toggle outputs | `BOOLEAN` | One per toggle with **BOOLEAN output** on, at the right of its row. Up to 16. |

## Toggles

- **Any on**: each toggle is on or off by itself. A toggle that **needs** another is off while that one is off, and keeps its own choice for when it is on again.
- **Pick one**: only one toggle is on: the one the upstream picked variable names (with **Upstream can pick**), else the first one upstream set on, else the first one you switched on. Optional **writes** variable gets the picked toggle's **Value**, or its name; internal unless **Show in prompt**.
- **When off**: Nothing, **Mute** or **Bypass** the nodes wired into the row's dot and any **Canvas groups** you pick, while the toggle is off (needs and Pick one count). Done on the canvas when the toggle flips.
- **Invert**: mute / bypass while the toggle is ON instead. An icon by the name shows a control is wired: coloured while it acts, dim while not; hover for the nodes.
- **Show** (by the variable): show the `$variable` under the name in the clean view.
- **Upstream can set it**: an upstream yes/no value for the toggle's variable (`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`) sets the switch for the run.
- **Clean and edit views**: the pencil at the top opens the edit view (mode, grips, row editors, Add toggle / Add label); **Done** goes back to the switches only.
- **Style**: switch, checkbox, two buttons (your own words, e.g. Day / Night) or chip.
- **Labels** group the toggles under them; fold one to hide them (their outputs gather on the label).

## Merge into WP Toggles

Select Boolean nodes, right-click, **Merge into WP Toggles**. A node merges when its only output is `BOOLEAN`, nothing is wired into it and it has one on/off value. Titles become names, values stay, wires move. One undo step.
