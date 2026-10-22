# WP Prompt Assembler

Write a prompt with `$variables` in it and get the finished prompt, plus a matching negative.

## Inputs

- **context**: the variables, from a WP Context (or any WP node with a context output).
- **template**: your prompt, such as `A $style portrait of $subject, $lighting`.
- **negative_template**: optional, in the fold-out section under the preview. Your standing negative, with `$negatives` where the collected negative words go.

## Outputs

- **prompt**: the finished prompt. Wire it into CLIP Text Encode or a WP Prompt Cleaner.
- **negative**: the negative words of the variables this template printed, plus your negative template. Wire it into your negative CLIP Text Encode.

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
