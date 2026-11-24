# WP Seeds

Named seeds in one place. Each row is a seed with a value for every frame of a Context Loop; each WP Context picks the row it runs on with its **Seed from** chip, and a row's output dot gives a sampler its own seed.

<!-- video:start -->
<!-- video:end -->

<!-- fields:start -->
## On the node

- **upstream (in)** `context`: Optional. A Context or a Context Loop. Put it after the Loop to get a seed per frame; Contexts after it can read its rows.
- **base_seed** `INT`: The seed every Follow row is made from, like the Loop's and Seed List's base seed. Reroll (above the rows inside a Loop, or in the edit view) or control after generate moves all of them at once; locked frames stay.
- **From Loop**: Shown with a Context Loop upstream. On, the rows follow the Loop's seed instead of base_seed (which greys out), like Seed List's base seed from loop: change the Loop's seed and every Follow row moves. Off (the default), the node keeps its own.
- **Rows**: One row per named seed, under labels that group and fold them. A row shows its icon and name, the seed it gives the frame shown (in the row's colour) and its mode, then three buttons: mode, last run and lock.
- **Frame**: Shown inside a Context Loop: the frame the rows show. It follows the frame picked under the Loop's Edit frame (outlined while it does), and stepping it picks that frame there too, so the Context rows, Assembler and WP Debug move with it.
- **Looks**: Like WP Toggles: in the edit view each label has an icon and a colour (its rows wear the colour on their left edge), and a row's window has Looks: an icon, the icon's colour, the name's colour and the seed's colour. None keeps the theme's.
- **Mode button (row)**: Cycles the row Follow → Random → Fixed without opening anything. Leaving Follow keeps the seed the row has, so nothing jumps until you reroll.
- **Last run (row)**: Puts the row back on the seed it started from last run and sets it to Fixed: the way back after a Random row rolled on, or to keep a result you liked. Greyed out before the first run and when the row is already on it.
- **Pencil (toolbar)**: Select the node and the pencil in ComfyUI's selection toolbar opens the edit view: grips to reorder, label names, each row's pencil (its window) and bin, Add seed, Add label and Reroll. Done goes back to the clean view.
- **Follow / Random / Fixed**: Follow: made from the base seed and the row's name, so renaming a row changes its seed. Random: its own seed, rolled again after every queue. Fixed: its own seed, never changes.
- **Per frame**: New (the default): every frame of a Context Loop gets its own seed, frame 1 being the row's seed. Same: every frame uses the row's seed.
- **Lock (row)**: Pins the shown frame's seed: the one it used last run if there was one, else the one it will use. The Frame box (or the Loop's Edit frame) picks which frame the rows show.
- **Seed window**: A row's pencil opens its window: name, mode, seed (New rolls one, Last run puts back last run's), New each frame or Same every frame, its INT output, and Frames: the row's seed on every frame of the Loop, each one a lock. Lock last run pins what the last run used; Unlock all clears them. Changes land when you press Done.
- **context (out)** `context`: The Context, carrying the rows. A Context after it picks a row with its Seed from chip.
- **seed outputs** `INT`: One INT per row with its output dot on, at the right of its row: wire it into a KSampler's seed or any INT input. After a Loop it gives one seed per frame. Up to 16.
<!-- fields:end -->

## How it works

Put WP Seeds in the Context chain after the Loop (Loop → WP Seeds → WP Context). ComfyUI then runs it once per frame, so every row gives that frame's seed: frame 1 is the row's own seed, later frames are made from it (or all the same with Per frame on Same). A lock pins one frame of one row.

A **Follow** row is made from the base seed (or the Loop's, with From Loop on) and the row's name, so Reroll moves all of them at once. The buttons on each row cycle its mode and put back the seed it ran with last time. **Random** rows roll a new seed after each queue, **Fixed** rows never change.

## Seed from

Every WP Context with a Loop or WP Seeds upstream shows a **Seed from** chip: Auto (the Loop's seed while it overrides, else its own), Loop, Own seed (the widget or its wire, even while the Loop overrides) or a WP Seeds row. Nothing takes priority on its own. A source that isn't upstream runs as Auto and WP Debug warns.

## Tips

- Rows are matched by name, ignoring case and extra spaces. Two rows with one name: the first wins.
- To keep a Follow row's seed while renaming it, switch it to Fixed first.
- For one seed per frame on a single sampler, WP Seed List is simpler.
