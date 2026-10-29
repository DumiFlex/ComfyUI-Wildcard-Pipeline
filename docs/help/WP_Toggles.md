# WP Toggles

Several on/off switches in one node. Each toggle writes `$its_variable` as `true` / `false` (always internal) and can have a `BOOLEAN` output.

## Inputs and outputs

| Name | Type | Notes |
|---|---|---|
| `upstream` | context | Optional. The Context to extend. |
| `context` (out) | context | Upstream plus every toggle variable. |
| toggle outputs | `BOOLEAN` | One per toggle with **BOOLEAN output** on, at the right of its row. Up to 16. |

## Toggles

- **Any on**: each toggle is on or off by itself. A toggle that **needs** another is off while that one is off, and keeps its own choice for when it is on again.
- **Pick one**: only one toggle is on. Optional **writes** variable gets the picked toggle's name.
- **Style**: switch, checkbox, two buttons (your own words, e.g. Day / Night) or chip.
- **Labels** group the toggles under them; fold one to hide them (their outputs gather on the label).

## Merge into WP Toggles

Select Boolean nodes, right-click, **Merge into WP Toggles**. A node merges when its only output is `BOOLEAN`, nothing is wired into it and it has one on/off value. Titles become names, values stay, wires move. One undo step.
