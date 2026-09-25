### Fixes

- **`$outfit.1.SHOES` now reads the second pick's shoe.** On a wildcard that picks several options, an indexed axis read skipped any pick whose option carries no tag on that axis, so every later index slid down by one: with `robe, jeans` picked, `$outfit.0.SHOES` printed the jeans' boots beside the robe and `$outfit.1.SHOES` came out empty. Each index now names the same pick as `$outfit.1`, in templates and in derivation conditions alike. The bare `$outfit.SHOES` read was already right and is unchanged.

- **The Prompt Assembler preview shows the tag that was actually rolled.** The preview filled `$outfit.SHOES` with the first tag of the group whatever the option, so it could read `sandals | robe | red stilettos` for an outfit with no shoes and a pair of heels. It now reads the same roll as the values beside it, and matches what the prompt will say.
