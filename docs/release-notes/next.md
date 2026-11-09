### New

- **Export as plain wildcard files.** Import / Export → Export has a new **Wildcard files (.zip)** button: the picks become `.txt` wildcard files for Dynamic Prompts, Impact Pack, Prompt-PostProcessor, Easy-Use and A1111/Forge, so you can share a pack with people who don't use Wildcard Pipeline. References and `$variables` become `__folder/name__`, uneven weights become repeated lines, and a README in the zip lists what had no plain form (rules, tags, the chance of nothing, negatives).

### Fixes

- **Subgraphs see the variables around them again.** On current ComfyUI frontends (1.5x) a WP Context or Assembler inside a subgraph never found the variables set outside it, so a `$time` wired in from the parent graph showed as MISSING VAR and the subgraph's badge counted conflicts that weren't there. The walk now crosses a subgraph's edges in both directions, upstream and downstream.
- **The subgraph badge shows in Nodes 2.0 straight away.** With Nodes 2.0 on, a subgraph's conflict badge only appeared after you entered and left the subgraph, or switched to the legacy nodes and back. It now shows, changes and clears as soon as the problem inside does.
- **Centred chevrons on WP Context Loop and WP Seed List.** The arrow on **Per-iteration seeds** and **Sweep combinations** sat right after the label and a little low; it now sits at the right edge, level with the label, with the locked / bypassed / frames badges just before it.
- **A Boolean node can drive a rule.** A ComfyUI Boolean wired into the Context Injector wrote `True` / `False`, so a derivation testing `equals true` (the way WP Toggles writes it) never matched. Booleans now read as `true` / `false` everywhere a variable is printed or tested.
