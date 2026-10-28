# WP Image Filter

Pauses the run so you can pick which images go on. Everything that belongs to an image (its latent, masks, conditioning, prompt text and Context) is filtered with it, so the node can sit between the first KSampler and the upscaler and the upscaler only gets the picked images with their own prompts.

## Inputs and outputs

Every input has a matching output. Connect only what you need.

- **images**: the images to pick from. Required; this is what the picker shows.
- **latent**, **masks**: sliced to the picked images. A mask you paint in the picker replaces that image's mask.
- **positive**, **negative**: CONDITIONING. A batched conditioning is sliced with the images; a single one is kept for each frame that keeps any image.
- **positive_text**, **negative_text**: the prompt strings, kept or dropped with their frame.
- **context**: the WP Context of each frame, kept or dropped with it.
- **clip** (input only, optional): re-encodes a prompt you edit in the picker, so the positive/negative conditioning follows the edit. Without it an edit changes only the text outputs.
- **extra_1**, **extra_2**: any type. The output takes the type of what you connect. Batched values are sliced; anything else follows its frame.
- **picks** (output only): what was kept, as `frame:image` (1-based), for example `1:2, 3:1`.

A Context Loop (or any list) makes one **frame** per iteration. Lists line up by frame; a shorter list repeats its last item.

## The picker

The picker has three modes, switched at the top or with **G**, **D** and **Z**. The window keeps its size in every mode, and the pick count and the Keep buttons are always in the footer. The picker opens in the mode you left it in.

- **Grid** (G) is for picking fast. Click an image to pick it, or press **Space** over it. Ctrl+A picks everything; a frame with several images says how many of its images are picked and has a **Pick frame** button (**Clear frame** once it is all picked). **Tile size** sets S, M or L; **Fit** (or **F**) makes the images as big as the picker allows. Double-click an image, or click the frame around it, to open it in Detail.
- **Detail** (D) shows one image next to its size and seed, with **Pick** / **Picked** (or **P**, **Space**, ↑), **Compare** and **Pick frame (N)** at the top of the side panel. Under them, three tabs: **Values** (the frame's variable values, each in the colour its words have in the prompt; the copy button copies them), **Prompt** (the prompt with each value marked in its variable's colour where it landed, hover a mark to see which variable set it, click to edit; the negative under it; each has a copy button) and **Mask**. Detail opens on Prompt, and painting switches to Mask. With no CLIP wired, a **text only** tag says an edit changes the text outputs only. Only what is wired shows: with no prompt text and no CLIP wired in, one line says how to get the prompt fields. ←/→ or ‹ › step, and the strip under the picture jumps to any image; a loop's images sit together in the strip, one group per frame, with how many of each are picked (double-click one to zoom it, or click the picture). **C** or **Compare** pins the image; step to another and a slider compares the two. **M** or **Paint** paints a mask.
- **Zoom** (Z) shows only the picture, at real zoom levels: **Fit**, **100%**, **200%**, − and + (keys 0, 1, 2, − and +). Scroll to zoom toward the mouse, drag to move, double-click for 100% at that spot. Zoomed in, a mini-map in the corner shows where you are; click or drag it to move there. Keep the mouse still for two seconds and the bar, hint and mini-map fade; move it and they come back. **F** or the fullscreen button fills the screen with it (Esc leaves); in fullscreen a strip along the bottom shows the frame's images, the pick count and **Keep picked**. ←/→ step to the next image and keep the zoom and the spot, so you can check the same hands or eyes in every frame. **P** picks, and the picture's label says **Picked**. **C** pins the image: step to another and the two show side by side, locked to the same zoom and spot (←/→ change the right one, **P** picks it, **C** again stops). The pin carries over between Detail and Zoom.
- **Escape** steps back: Zoom to Detail, Detail to Grid, and from Grid it tucks the picker away. A "waiting" pill stays at the bottom of the screen and reopens it with your picks still there. The − button in the header tucks it away from any mode.
- **Enter** or **Keep N picked** sends the picks on. **Keep all** sends everything. **Stop branch** stops the nodes after this one; the rest of the run finishes normally.
- A short chime plays when the picker opens, and the tab title starts with **● Pick images** while something waits. Turn the chime off under **Settings → Wildcard Pipeline → Runtime behavior → Image Filter sound**. Turn on **Image Filter desktop notification** there to also get a system notification while the tab is in the background.

## Labels, sweep grid and Send to Loop

- With a Context Loop, each frame is labelled with its number and the options its sweep pinned, for example `#3 · red · pencil`. Hover a label for the frame's seed and prompt.
- A sweep of two or more wildcards opens in Grid as a **table**. The bar above it picks which wildcard goes on **Rows** and which on **Columns** (⇄ swaps them); any others **Split by**, one small grid per value. Click a row, column or group name to pick all of it. **Layout › Frames** switches back to the list.
- **Send to Loop** writes your picks back to the loop: picked frames get their seeds locked (when the loop overrides seeds) and every other frame is bypassed, so the next run repeats only what you kept.

## Refine before it goes on

In **Detail**, the side panel edits the frame's prompts and paints a mask for the upscaler. Tiles show ✎ for an edited prompt and ◐ for a painted mask.

- An edited prompt replaces the text output. With a CLIP wired into **clip**, the conditioning is re-encoded to match; without one it stays as it was, and the panel says so.
- With **Same shape** a frame's picks go on together, so a prompt edit covers the whole frame. With **One per image** it covers just that image.
- **M** or **Paint** opens the mask painter: brush, eraser, size, invert and clear. A ring under the mouse shows how big the brush is (dashed for the eraser). The mask goes to the **masks** output, resized to the image. Images you don't paint keep the incoming mask, or an empty one when nothing is wired in.

![How the picks carry over](images/how-picks-carry-over.webp)

## Settings on the node

- **Mode**: **Pause & pick** asks every run. **Reuse last picks** keeps the same picks without asking, and asks again when they no longer fit (for example the batch size changed). **Pass all** lets everything through.
- **Send picks as**: **Same shape** keeps each frame's picks together as one batch. **One per image** sends every pick as its own item, with its own copy of the frame's prompt, conditioning and Context.
- **Timeout**: seconds to wait. 0 waits until you answer. After a timeout it keeps all, keeps the first image, or stops the branch.

## Tips

- The **LAST RUN** strip shows what the last run kept.
- Cancelling the run while the picker is open closes it.
- Use the **picks** output in a filename or a note to remember which images you picked.
