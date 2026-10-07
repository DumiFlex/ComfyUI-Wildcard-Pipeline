# WP Image Filter

Pauses the run so you can pick which images go on. Everything that belongs to an image (its latent, masks, conditioning, prompt text and Context) is filtered with it, so the node can sit between the first KSampler and the upscaler and the upscaler only gets the picked images with their own prompts.

## Inputs and outputs

Every input has a matching output. Connect only what you need.

- **images**: the images to pick from. Required; this is what the picker shows.
- **latent**, **masks**: sliced to the picked images.
- **positive**, **negative**: CONDITIONING. A batched conditioning is sliced with the images; a single one is kept for each frame that keeps any image.
- **positive_text**, **negative_text**: the prompt strings, kept or dropped with their frame.
- **context**: the WP Context of each frame, kept or dropped with it.
- **extra_1**, **extra_2**: any type. The output takes the type of what you connect. Batched values are sliced; anything else follows its frame.
- **picks** (output only): what was kept, as `frame:image` (1-based), for example `1:2, 3:1`.

A Context Loop (or any list) makes one **frame** per iteration. Lists line up by frame; a shorter list repeats its last item.

## The picker

- Click an image to pick it. Click a frame's label to pick the whole frame. Ctrl+A picks everything.
- **Space** zooms the image under the mouse. In the zoom, ←/→ move and ↑ picks.
- **Enter** or **Keep N picked** sends the picks on. **Keep all** sends everything. **Stop branch** stops the nodes after this one; the rest of the run finishes normally.
- A short chime plays when the picker opens, so you hear it from another tab. Turn it off under **Settings → Wildcard Pipeline → Runtime behavior → Image Filter sound**.
- **Escape** or the − button tucks the picker away. A "waiting" pill stays at the bottom of the screen and reopens it with your picks still there.

## Settings on the node

- **Mode**: **Pause & pick** asks every run. **Reuse last picks** keeps the same picks without asking, and asks again when they no longer fit (for example the batch size changed). **Pass all** lets everything through.
- **Nothing picked**: what to do when no image is picked: stop this branch, or keep all.
- **Send picks as**: **Same shape** keeps each frame's picks together as one batch. **One per image** sends every pick as its own item, with its own copy of the frame's prompt, conditioning and Context.
- **Timeout**: seconds to wait. 0 waits until you answer. After a timeout it keeps all, keeps the first image, or stops the branch.

## Tips

- The **LAST RUN** strip shows what the last run kept.
- Cancelling the run while the picker is open closes it.
- Use the **picks** output in a filename or a note to remember which images you picked.
