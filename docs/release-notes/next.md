### Features

- **Test Runner baselines: see what an edit changed.** Run a saved scenario, open the new **Compare** tab and choose **Save as baseline**. After you edit a module, run the scenario again and Compare lists every seed whose output changed, with the removed and added words highlighted, plus any variable values and warnings that appeared or went away. Seeds are deterministic, so for an unchanged stack every seed matches, and a real change never gets lost among random ones. A scenario on random seeds can rerun the baseline's own seeds in one click.
- **Re-run all pinned scenarios at once.** **Re-run all** next to the Pinned heading in the Test Runner runs every pinned scenario as saved. Each one's badge then says whether it still **matches** its baseline or how many outputs **changed**.
- **See which scenarios use a module.** The wildcard and derivation editors show **In N scenarios** beside the Test Runner button. It opens the Test Runner with the list narrowed to those scenarios.
- **Inspect any module in a Test Runner scenario.** Click a stack card to see how that module is set up next to what the last run did with it. A wildcard shows each option's share of the weight beside how often it was actually picked, and flags options that never came up. A constraint shows what it links, how far it reaches and how many times it applied. Combines, derivations, fixed values and bundles each get their own view, and **Edit** opens the module's editor.
- **Test Runner guide in the docs.** Documentation now has a Test Runner page covering scenarios, reading a run, the inspector and baselines.

### Fixes

- **Test Runner in the light theme.** The closed trace drawer no longer casts a dark shadow down the right edge of the page, and the drawer and module picker shadows now follow the theme.
