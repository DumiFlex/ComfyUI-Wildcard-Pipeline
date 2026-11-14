# WP Prompt Assembler

Write a prompt with `$variables` in it and get the finished prompt, plus a matching negative.

<!-- video:start -->
▶ **Video:** [WP Prompt Assembler in depth](https://youtu.be/Zq7pY42f_qI) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## Inputs and outputs

- **context (in)** `context`: The variables from a WP Context (or anything that ends in one).
- **template** `STRING`: Your prompt with $variables in it. Wire another node's text into it to use that text as the template instead: the box then says "From the template input", and the $variables in the wired text still fill in.
- **negative_template** `STRING`: Optional, in the collapsible negative section. Your standing negative, with $negatives where the collected negative words go. New Assemblers start with $negatives; without it the negative is only your own text (empty = no negative). It takes a wired text the same way the template does.
- **prompt (out)** `STRING`: The finished prompt. Wire it into CLIP Text Encode or a WP Prompt Cleaner.
- **negative (out)** `STRING`: The negative words of the variables this template printed, plus your negative template. Wire it into your negative CLIP Text Encode.

## On the node

- **Load / Save (toolbar)**: Load a template from your library into both boxes, or save this one (prompt and negative) to it.
- **Mark unused internal (toolbar)**: The eye button. Marks every upstream variable that neither box reads as internal, so it stops showing here; combines and rules still read it. Variables another Assembler on the same context reads are kept, and so is a module that also writes a variable in use. Undo in the message puts it back.
- **Clear (toolbar)**: Empties the template and the negative template, after asking.
- **Frame arrows (preview)**: Only with a WP Context Loop upstream: ‹ 1/4 › steps the preview through the loop's frames and moves the Loop's Edit frame pick with it. A variable only some frames set shows as a blue chip with its frames (#4), never as missing.
<!-- fields:end -->

## How to use

1. Wire a WP Context into **context**.
2. Write the template. Type `$` to pick a variable, or click a chip in the **variables** strip.
3. Run. Each `$name` becomes its value.

In the preview, picked values are highlighted. A variable nothing sets gets an amber wavy underline and prints nothing.

## The negative output

Wildcard options, fixed values, combines, derivations and Injector rows can carry negative words. The negative output only takes the words of variables this template printed, so a face-detailer Assembler that prints just `$face` gets only the face words. Hidden variables add nothing.

- `lowres, bad anatomy, $negatives` puts the collected words at that spot.
- An empty negative template gives just the collected words.
- Without `$negatives`, the collected words go at the end.
- Repeated words are dropped, also when written differently: `(blurry:1.2)` counts as `blurry`.

## Toolbar

- **Clear template** empties the template and the negative template.
- **Load** picks a saved template from your library (it asks first if you've typed something).
- **Save** keeps the template in your library. If it came from the library you can update that entry or save a new one.

Saved templates are on the manager's **Templates** page.

## Tips

- `$$` prints a plain `$`.
- The Assembler doesn't roll: `{a|b}` prints as typed and `@{…}` prints nothing. Put choices in a wildcard and print its variable.
- When you queue, a warning names any `$variable` nothing sets.
