### Features

- **Link one wildcard's pick to another's with the new Only rule.** A constraint rule set to **Only** turns its row into a short list. An exception *maid → frilled apron* in Only mode means that whenever the source rolls "maid", the target can only roll "frilled apron", and an outfit you add to the target later is shut out too. Before, the same link needed an Exclude rule for every other outfit, and any outfit added afterwards slipped through. In the matrix, an Only cell links subcategories the same way, and the other cells in that row show a faint × so you can see what is shut out. Only is in the cell popover, the exceptions mode picker and the canvas instance editor. Constraints that use it publish as schema version 6, so an older extension refuses them and asks you to update instead of failing the constraint.

### Fixes

- **Setting a matrix cell back to Neutral on the canvas no longer breaks the constraint.** Overriding a library rule to Neutral in a Context node's constraint editor saved a value the engine didn't accept, so the whole constraint stopped applying when the graph ran. The editor now saves it correctly, and workflows saved with the old value run again.
- **The constraint docs described Allow wrongly.** They said Allow keeps only the matching options. Allow has always meant "no change" (it shows as Neutral in the matrix). The docs now say so, and the keep-only behaviour they described is what Only does.
